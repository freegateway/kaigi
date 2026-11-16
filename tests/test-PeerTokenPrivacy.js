'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const Peer = require('../app/src/Peer');
const Room = require('../app/src/Room');
const checkXSS = require('../app/src/XSS');
const Validator = require('../app/src/Validator');
const source = fs.readFileSync(require.resolve('../app/src/Server'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first);
    return source.slice(first, last);
}

describe('peer token privacy', function () {
    this.timeout(8000);

    it('strips tokens defensively from directly constructed peers', () => {
        const peer = new Peer('direct', { peer_info: { peer_name: 'Direct', peer_token: 'private-marker' } });
        assert(!Object.hasOwn(peer.peer_info, 'peer_token'));
        assert(!JSON.stringify(peer).includes('private-marker'));
    });

    it('keeps credentials out of real Socket.IO join snapshots, producer lists and webhook data', async () => {
        const server = http.createServer(), io = new Server(server, { transports: ['websocket'] });
        const clients = [], hooks = [], constructorInputs = [], peers = new Map();
        let grant = true, revoked = false;
        const sessions = { 'alice-private-token': { id: 'alice-session', username: 'alice', displayName: 'Alice' },
            'bob-private-token': { id: 'bob-session', username: 'bob', displayName: 'Bob' } };
        function authenticatedSession(token) {
            assert(!revoked);
            assert(sessions[token]);
            return sessions[token];
        }
        const room = {
            id: 'meeting', sessionId: 'meeting-session', peers,
            getPeers: () => peers, getPeersCount: () => peers.size,
            getPeer: id => peers.get(id), addPeer: peer => peers.set(peer.id, peer), removePeer: id => peers.delete(id),
            isBanned: () => false, isJoinLocked: () => false, isLocked: () => false,
            isLobbyEnabled: () => false, isGlobalLobbyEnabled: () => false,
            getSessionId: () => 'meeting-session', getRoomNotifications: () => ({}),
            toJson: () => ({ peers: JSON.stringify([...peers]), recording: {} }),
            videoDrawingPermissions: new Map(),
        };
        vm.runInNewContext(section('    io.use((socket, next) => {', "    io.on('connection'"), {
            io, authenticatedSession, securityEvent() {},
        });
        io.on('connection', socket => {
            socket.room_id = 'meeting';
            vm.runInNewContext(section("        socket.on('join'", "        socket.on('getRouterRtpCapabilities'"), {
                socket, roomExists: () => true, getIpSocket: () => '127.0.0.1', checkXSS, Validator,
                getRoom: () => room, hostCfg: { user_auth: true }, isValidToken: async token => !!sessions[token],
                authenticatedSession, sessionAllowsRoom: async () => grant,
                Peer: class extends Peer {
                    constructor(id, data) {
                        constructorInputs.push(JSON.parse(JSON.stringify(data.peer_info)));
                        super(id, data);
                    }
                },
                getActiveRooms: () => [], getRTMPActiveStreams: () => [], presenters: {},
                log: { debug() {}, warn() {}, error() {} }, widget: { enabled: false, alert: { enabled: true } },
                nodemailer: { sendEmailNotifications() {} }, handleJoinWebHook: (...args) => hooks.push(args),
                recordingAllowedIn: () => false, serverRecordingEnabled: false, rtmpEnabled: false,
                securityEvent() {},
            });
            socket.on('fixtureProducers', (_, ack) => ack(Room.prototype.getProducerListForPeer.call(room, socket.id)));
        });
        async function connect(token) {
            const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
            clients.push(ws);
            let sequence = 0;
            const pending = new Map();
            await new Promise((resolve, reject) => {
                ws.on('error', reject);
                ws.on('message', raw => {
                    const packet = String(raw);
                    if (packet.startsWith('0')) ws.send('40' + JSON.stringify({ token }));
                    else if (packet === '2') ws.send('3');
                    else if (packet.startsWith('40')) resolve();
                    else if (packet.startsWith('43')) {
                        const match = /^43(\d+)(\[.*\])$/.exec(packet);
                        if (match) { pending.get(+match[1])?.(JSON.parse(match[2])[0]); pending.delete(+match[1]); }
                    }
                });
            });
            return (event, payload) => new Promise(resolve => {
                const id = ++sequence; pending.set(id, resolve);
                ws.send('42' + id + JSON.stringify([event, payload]));
            });
        }
        function join(token) { return { peer_info: { peer_name: sessions[token].displayName, peer_token: token, peer_presenter: true } }; }
        try {
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const alice = await connect('alice-private-token'), bob = await connect('bob-private-token');
            assert.equal(typeof (await alice('join', join('alice-private-token'))), 'object');
            peers.values().next().value.producers.set('audio', { id: 'audio', appData: { mediaType: 'audioType' } });
            const snapshot = await bob('join', join('bob-private-token'));
            const producers = await bob('fixtureProducers', {});
            assert.equal(producers.length, 1);
            assert.equal(JSON.parse(snapshot.peers).length, 2);
            for (const payload of [snapshot, producers, hooks, constructorInputs]) {
                const text = JSON.stringify(payload);
                assert(!text.includes('private-token'));
                assert(!text.includes('peer_token'));
            }
            for (const peer of peers.values()) assert.equal(peer.peer_presenter, false);
            assert.equal(await bob('join', join('alice-private-token')), 'unauthorized');
            grant = false;
            assert.equal(await bob('join', join('bob-private-token')), 'notAllowed');
            grant = true; revoked = true;
            assert.equal(await bob('join', join('bob-private-token')), 'unauthorized');
        } finally {
            clients.forEach(ws => ws.terminate());
            await new Promise(resolve => io.close(resolve));
        }
    });
});
