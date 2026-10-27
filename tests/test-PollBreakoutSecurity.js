'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const Validator = require('../app/src/Validator');
const checkXSS = require('../app/src/XSS');
const { securityEvent } = require('../app/src/SecurityEvents');

const source = fs.readFileSync(path.join(__dirname, '../app/src/Server.js'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start),
        last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, `Missing server section: ${start}`);
    return source.slice(first, last);
}

// Actual WebSocket/Socket.IO packets run production authentication/admission
// middleware, poll handlers, breakout handlers and structured logging. Session
// lookup and meetings are fixtures; no daemon or media worker is launched.
describe('poll and breakout security over Socket.IO', function () {
    this.timeout(7000);
    let io, clients, rooms, logs, sockets;
    function makeRoom(id) {
        const polls = [],
            deliveries = [],
            peers = new Map();
        return {
            id,
            polls,
            deliveries,
            peers,
            _moderator: {},
            getPeer: (id) => peers.get(id),
            getPeers: () => peers,
            getPeersCount: () => peers.size,
            getPolls: () => polls,
            convertPolls: (values) => values.map((poll) => ({ ...poll, voters: Array.from(poll.voters) })),
            sendToAll: (...args) => deliveries.push(args),
            sendTo: (...args) => deliveries.push(args),
        };
    }
    beforeEach(async function () {
        clients = [];
        logs = [];
        sockets = new Map();
        rooms = new Map(['approved', 'other', 'other_breakout_1'].map((id) => [id, makeRoom(id)]));
        const server = http.createServer();
        io = new Server(server, { transports: ['websocket'] });
        const emitSecurity = (...args) => {
            const saved = console.log;
            console.log = (line) => logs.push(JSON.parse(line));
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
                if (!['approved', 'other'].includes(token)) throw new Error('Invalid session');
                return { id: token };
            },
        });
        io.on('connection', (socket) => {
            socket.on('error', () => {});
            socket.room_id = socket.authSessionId;
            socket.authenticatedMeeting = true;
            sockets.set(socket.room_id, socket);
            const room = rooms.get(socket.room_id);
            const peer = { peer_name: socket.room_id + '-attendee' };
            room.peers.set(socket.id, peer);
            const context = vm.createContext({
                socket,
                roomList: rooms,
                Map,
                Validator,
                checkXSS,
                securityEvent: emitSecurity,
                requireAuthSession: (id) => assert(['approved', 'other'].includes(id)),
                roomExists: (s) => rooms.has(s.room_id),
                getRoom: (s) => rooms.get(s.room_id),
                getRoomAndPeer: (s) => ({ room: rooms.get(s.room_id), peer: rooms.get(s.room_id).getPeer(s.id) }),
                isPeerPresenter: () => false,
                log: { debug() {}, warn() {} },
            });
            vm.runInContext(
                section('        socket.use((packet, next) => {', "        socket.on('clientError'"),
                context
            );
            vm.runInContext(section("        socket.on('createPoll'", '        // Room collaborative editor'), context);
            vm.runInContext(
                section("        socket.on('getBreakoutRoomsInfo'", '        // BREAKOUT ROOMS END'),
                context
            );
            socket.on('getMeetingRecordingPolicy', (_, ack) => ack({ ready: true }));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        this.port = server.address().port;
    });
    afterEach(async () => {
        for (const client of clients) client.ws.terminate();
        if (io) await new Promise((resolve) => io.close(resolve));
    });
    async function connect(port, token) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
        const pending = new Map();
        let nextAck = 0;
        const client = {
            ws,
            send: (event, data) => ws.send('42' + JSON.stringify([event, data])),
            request: (event, data = {}) =>
                new Promise((resolve, reject) => {
                    const id = ++nextAck;
                    const timeout = setTimeout(() => {
                        pending.delete(id);
                        reject(new Error(`No ack for ${event}`));
                    }, 2000);
                    pending.set(id, (data) => {
                        clearTimeout(timeout);
                        resolve(data);
                    });
                    ws.send('42' + id + JSON.stringify([event, data]));
                }),
        };
        clients.push(client);
        await new Promise((resolve, reject) => {
            ws.on('error', reject);
            ws.on('message', (raw) => {
                const packet = String(raw);
                if (packet.startsWith('0')) ws.send('40' + JSON.stringify({ token }));
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
        return client;
    }
    const barrier = (client) => client.request('getMeetingRecordingPolicy');
    const validPoll = () => ({ question: 'Question?', options: ['Yes', 'No'] });

    it('rejects malformed indexes in vote/edit/delete without mutation or broadcast', async function () {
        const client = await connect(this.port, 'approved'),
            room = rooms.get('approved');
        client.send('createPoll', validPoll());
        await barrier(client);
        room.deliveries.length = 0;
        for (const index of ['constructor', '__proto__', 'length', '0', -1, 0.5, 1, null, {}, []]) {
            client.send('vote', { pollIndex: index, option: 'Yes' });
            client.send('editPoll', { index, question: 'changed', options: ['A', 'B'] });
            client.send('deletePoll', { index });
        }
        await barrier(client);
        assert.equal(room.polls.length, 1);
        assert.equal(room.polls[0].question, 'Question?');
        assert.equal(room.polls[0].voters.size, 0);
        assert.equal(room.deliveries.length, 0);
        assert.equal(logs.length, 30);
        assert(logs.every((entry) => entry.reason === 'invalid_poll'));
    });
    it('rejects malformed payloads and votes outside the available choices', async function () {
        const client = await connect(this.port, 'approved'),
            room = rooms.get('approved');
        client.send('createPoll', validPoll());
        await barrier(client);
        room.deliveries.length = 0;
        for (const payload of [null, {}, [], 'bad', 1]) {
            for (const event of ['createPoll', 'vote', 'editPoll', 'deletePoll']) client.send(event, payload);
        }
        client.send('vote', { pollIndex: 0, option: {} });
        client.send('vote', { pollIndex: 0, option: 'not-an-option' });
        client.send('editPoll', { index: 0, question: {}, options: ['A'] });
        await barrier(client);
        assert.equal(room.polls.length, 1);
        assert.equal(room.polls[0].voters.size, 0);
        assert.equal(room.deliveries.length, 0);
    });
    it('rejects corrupt poll entries and sparse array indexes without throwing', async function () {
        const client = await connect(this.port, 'approved'),
            room = rooms.get('approved');
        for (const poll of [null, {}, { voters: {}, options: ['Yes'] }]) {
            room.polls[0] = poll;
            client.send('vote', { pollIndex: 0, option: 'Yes' });
            client.send('editPoll', { index: 0, ...validPoll() });
            client.send('deletePoll', { index: 0 });
            await barrier(client);
            assert.equal(room.polls[0], poll);
        }
        delete room.polls[0];
        assert.equal(Validator.isValidArrayIndex(0, room.polls), false);
        assert.equal(room.deliveries.length, 0);
    });
    it('preserves ordinary create/vote/edit/delete and moderator restrictions', async function () {
        const client = await connect(this.port, 'approved'),
            room = rooms.get('approved');
        client.send('createPoll', validPoll());
        client.send('vote', { pollIndex: 0, option: 'Yes', peer_name: 'spoof' });
        await barrier(client);
        assert.equal(room.polls[0].voters.get('approved-attendee'), 'Yes');
        client.send('editPoll', { index: 0, question: 'Edited?', options: ['Yes', 'No'] });
        await barrier(client);
        assert.equal(room.polls[0].question, 'Edited?');
        room._moderator.polls_cant_create = true;
        client.send('deletePoll', { index: 0 });
        await barrier(client);
        assert.equal(room.polls.length, 1);
        room._moderator.polls_cant_create = false;
        client.send('deletePoll', { index: 0 });
        await barrier(client);
        assert.equal(room.polls.length, 0);
        assert.equal(logs.length, 0);
    });
    it('denies every breakout operation across two admitted meetings and minimizes logs', async function () {
        const attacker = await connect(this.port, 'approved');
        const victim = await connect(this.port, 'other');
        rooms.get('other_breakout_1').peers.set('victim-id', { peer_name: 'private-victim' });
        const events = [
            'getBreakoutRoomsInfo',
            'breakoutRoomHelp',
            'breakoutRoomBroadcast',
            'breakoutRoomEnd',
            'breakoutRoomCountdown',
            'breakoutRoom',
        ];
        for (const event of events) {
            const result = await attacker.request(event, {
                mainRoom: 'other',
                targetRoom: 'other_breakout_1',
                peer_name: 'secret-marker',
                breakoutRoom: 'other_breakout_1',
                message: 'secret-marker',
                countdown: 10,
                assignments: [{ peerId: sockets.get('other').id, breakoutRoom: 'other_breakout_1' }],
                password: 'secret-marker',
                token: 'secret-marker',
            });
            assert.deepEqual(result, { error: 'Breakout rooms are disabled' });
        }
        await barrier(victim);
        for (const room of rooms.values()) assert.equal(room.deliveries.length, 0);
        assert.equal(logs.length, events.length);
        for (const entry of logs) {
            assert.equal(entry.reason, 'breakout_disabled');
            assert.deepEqual(Object.keys(entry).sort(), ['component', 'event', 'ip', 'reason', 'timestamp']);
        }
        assert(!JSON.stringify(logs).includes('marker'));
        assert(!JSON.stringify(logs).includes('private-victim'));
    });
    it('keeps the admission gate in front of poll mutations', async function () {
        const client = await connect(this.port, 'approved');
        sockets.get('approved').authenticatedMeeting = false;
        client.send('createPoll', validPoll());
        client.send('vote', { pollIndex: 0, option: 'Yes' });
        await barrier(client);
        assert.equal(rooms.get('approved').polls.length, 0);
        assert(logs.every((entry) => entry.reason === 'not_admitted'));
    });
});
