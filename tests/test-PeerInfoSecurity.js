'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const Peer = require('../app/src/Peer');
const Validator = require('../app/src/Validator');
const checkXSS = require('../app/src/XSS');
const { securityEvent } = require('../app/src/SecurityEvents');

const source = fs.readFileSync(path.join(__dirname, '../app/src/Server.js'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, `Missing server section: ${start}`);
    return source.slice(first, last);
}

// Real Engine.IO/Socket.IO frames exercise the production middleware, handlers,
// Peer and security logger. Authentication/session lookup and media allocation
// are fixture boundaries; this does not launch the full daemon or a media worker.
describe('protected peer info over Socket.IO', function () {
    this.timeout(5000);
    let io, ws, state, nextAck, pending;

    beforeEach(async () => {
        state = { broadcasts: [], logs: [], mediaCalls: 0, closedProducers: [], admitted: true };
        nextAck = 1;
        pending = new Map();
        const server = http.createServer();
        io = new Server(server, { transports: ['websocket'] });
        const emitSecurity = (...args) => {
            const saved = console.log;
            console.log = (line) => state.logs.push(JSON.parse(line));
            try {
                securityEvent(...args);
            } finally {
                console.log = saved;
            }
        };
        vm.runInNewContext(section('    io.use((socket, next) => {', "    io.on('connection'"), {
            io,
            securityEvent: emitSecurity,
            authenticatedSession: (token) => {
                assert.equal(token, 'fixture-session');
                return { id: 'live' };
            },
        });
        io.on('connection', (socket) => {
            socket.on('error', () => {});
            socket.room_id = 'meeting';
            socket.authenticatedMeeting = state.admitted;
            state.socket = socket;
            state.peer = new Peer(socket.id, {
                peer_info: {
                    peer_name: 'Attendee',
                    peer_presenter: false,
                    peer_lobby: !state.admitted,
                    peer_audio: true,
                },
            });
            const room = {
                getPeer: () => state.peer,
                broadCast: (...args) => state.broadcasts.push(args),
                createWebRtcTransport: async () => {
                    state.mediaCalls++;
                    return { id: 'fixture-transport' };
                },
                closeProducer: (...args) => state.closedProducers.push(args),
            };
            const context = vm.createContext({
                socket,
                roomList: new Map([['meeting', room]]),
                securityEvent: emitSecurity,
                requireAuthSession: (id) => assert.equal(id, 'live'),
                roomExists: () => true,
                getRoomAndPeer: () => ({ room, peer: state.peer }),
                getPeerInfo: () => ({ peer_name: 'Attendee' }),
                checkXSS,
                Validator,
                recordingAllowedIn: () => false,
                log: { debug() {}, warn() {} },
            });
            vm.runInContext(
                section('        function rejectProtectedPeerInfo(', '        function getPeerInfo('),
                context
            );
            vm.runInContext(
                section('        socket.use((packet, next) => {', "        socket.on('clientError'"),
                context
            );
            for (const [start, end] of [
                ["        socket.on('updatePeerInfo'", "        socket.on('updateRoomNotifications'"],
                ["        socket.on('producerClosed'", "        socket.on('pauseProducer'"],
                ["        socket.on('createWebRtcTransport'", "        socket.on('connectTransport'"],
            ])
                vm.runInContext(section(start, end), context);
            // Ack provides an ordering barrier after all preceding client events.
            socket.on('getMeetingRecordingPolicy', (_, ack) => ack({ ready: true }));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
        const connected = new Promise((resolve, reject) => {
            ws.on('error', reject);
            ws.on('message', (raw) => {
                const packet = String(raw);
                if (packet.startsWith('0')) ws.send('40{"token":"fixture-session"}');
                else if (packet === '2') ws.send('3');
                else if (packet.startsWith('40')) resolve();
                else if (packet.startsWith('43')) {
                    const match = /^43(\d+)(\[.*\])$/.exec(packet);
                    if (match) {
                        pending.get(Number(match[1]))?.(JSON.parse(match[2])[0]);
                        pending.delete(Number(match[1]));
                    }
                }
            });
        });
        await connected;
    });

    afterEach(async () => {
        ws?.terminate();
        if (io) await new Promise((resolve) => io.close(resolve));
    });

    function send(event, payload) {
        ws.send('42' + JSON.stringify([event, payload]));
    }
    function request(event, payload = {}) {
        const id = nextAck++;
        return new Promise((resolve) => {
            pending.set(id, resolve);
            ws.send('42' + id + JSON.stringify([event, payload]));
        });
    }
    const barrier = () => request('getMeetingRecordingPolicy');

    for (const event of ['updatePeerInfo', 'producerClosed']) {
        for (const type of ['lobby', 'presenter']) {
            it(`${event} rejects protected ${type} changes before mutation or broadcast`, async () => {
                if (type === 'lobby') state.peer.updatePeerInfo({ type, status: true });
                send(event, {
                    type,
                    status: type === 'presenter',
                    broadcast: true,
                    producer_id: 'producer',
                    password: 'secret-marker',
                    token: 'token-marker',
                    peer_name: 'untrusted-marker\ntext',
                });
                await barrier();
                assert.equal(state.peer.peer_lobby, type === 'lobby');
                assert.equal(state.peer.peer_info.peer_lobby, type === 'lobby');
                assert.equal(state.peer.peer_presenter, false);
                assert.equal(state.peer.peer_info.peer_presenter, false);
                assert.equal(state.broadcasts.length, 0);
                assert.equal(state.closedProducers.length, 0);
                assert.equal(state.logs.length, 1);
                assert.equal(state.logs[0].reason, 'protected_peer_info');
                assert.deepEqual(Object.keys(state.logs[0]).sort(), [
                    'component',
                    'event',
                    'ip',
                    'reason',
                    'timestamp',
                ]);
                assert(!JSON.stringify(state.logs).includes('marker'));
                if (type === 'lobby') {
                    assert.deepEqual(await request('createWebRtcTransport'), { error: 'In lobby' });
                    assert.equal(state.mediaCalls, 0);
                }
            });
        }
    }

    it('a waiting socket cannot change its lobby state or obtain media through either event', async () => {
        state.socket.authenticatedMeeting = false;
        state.peer.updatePeerInfo({ type: 'lobby', status: true });
        for (const event of ['updatePeerInfo', 'producerClosed']) {
            send(event, { type: 'lobby', status: false, broadcast: true });
            send(event, { type: 'presenter', status: true, broadcast: true });
        }
        assert.deepEqual(await request('createWebRtcTransport'), { error: 'Not in meeting' });
        assert.equal(state.peer.peer_lobby, true);
        assert.equal(state.peer.peer_presenter, false);
        assert.equal(state.mediaCalls, 0);
        assert.equal(state.broadcasts.length, 0);
        assert.equal(state.logs.length, 5);
        assert(state.logs.every((entry) => entry.reason === 'not_admitted'));
    });

    it('permits ordinary peer updates, producer closure and admitted media requests', async () => {
        send('updatePeerInfo', { type: 'audio', status: false, broadcast: true });
        send('producerClosed', { type: 'video', status: false, producer_id: 'producer' });
        assert.deepEqual(await request('createWebRtcTransport'), { id: 'fixture-transport' });
        assert.equal(state.peer.peer_audio, false);
        assert.equal(state.peer.peer_video, false);
        assert.equal(state.broadcasts.length, 1);
        assert.equal(state.closedProducers.length, 1);
        assert.equal(state.closedProducers[0][1], 'producer');
        assert.equal(state.mediaCalls, 1);
        assert.equal(state.logs.length, 0);
        assert.equal(state.peer.peer_presenter, false);
    });

    it('preserves the recording restriction', async () => {
        send('updatePeerInfo', { type: 'recording', status: true, broadcast: true });
        await barrier();
        assert.notEqual(state.peer.peer_recording, true);
        assert.equal(state.broadcasts.length, 0);
    });
});
