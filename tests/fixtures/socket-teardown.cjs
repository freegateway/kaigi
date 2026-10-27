'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const { securityEvent } = require('../../app/src/SecurityEvents');

const mode = process.argv[2];
const source = fs.readFileSync(process.argv[3] || path.join(__dirname, '../../app/src/Server.js'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start),
        last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, `Missing server section: ${start}`);
    return source.slice(first, last);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run in a child process with no uncaughtException handler: the original
// production race must fail this process, not be swallowed by a test stub.
async function main() {
    const server = http.createServer();
    const io = new Server(server, { transports: ['websocket'] });
    const logs = [],
        errors = [],
        sockets = [],
        rooms = new Map();
    let calls = 0,
        releases = 0,
        removed = 0,
        deliveries = 0;
    const emitSecurity = (...args) => {
        const original = console.log;
        console.log = (line) => logs.push(JSON.parse(line));
        try {
            securityEvent(...args);
        } finally {
            console.log = original;
        }
    };
    vm.runInNewContext(section('    io.use((socket, next) => {', "    io.on('connection'"), {
        io,
        Error,
        securityEvent: emitSecurity,
        authenticatedSession: (token) => {
            assert.equal(token, 'live');
            return { id: 'live' };
        },
    });
    io.on('connection', (socket) => {
        sockets.push(socket);
        const admitted = mode !== 'unadmitted';
        socket.room_id = 'meeting';
        socket.authenticatedMeeting = admitted;
        const peer = { peer_name: 'attendee', peer_uuid: 'fixture-uuid' };
        const room = {
            getPeer: () => peer,
            removePeer: () => removed++,
            broadCast: () => deliveries++,
            getPeersCount: () => 0,
        };
        if (admitted) rooms.set('meeting', room);
        if (mode === 'missing_session') socket.authSessionId = null;
        const context = vm.createContext({
            socket,
            Error,
            roomList: rooms,
            securityEvent: emitSecurity,
            requireAuthSession: () => {
                if (mode === 'expired') throw new Error('secret-marker');
            },
            log: { error: (label) => errors.push(label), debug() {} },
            releaseWhiteboardSnapshotSocket: () => releases++,
            roomExists: (s) => rooms.has(s.room_id),
            getRoomAndPeer: () => ({ room, peer }),
            isPeerPresenter: () => false,
            webhook: { enabled: false },
            presenters: {},
            hostCfg: {},
            removeMeData: () => ({}),
            assignFallbackPresenter: () => null,
            stopRTMPActiveStreams() {},
            getActiveRooms: () => [],
            getRTMPActiveStreams: () => [],
            removeIP() {},
        });
        // Include the real error handlers, not a no-op error listener.
        vm.runInContext(
            section('        socket.use((packet, next) => {', "        socket.on('getMeetingRecordingPolicy'"),
            context
        );
        vm.runInContext(section("        socket.on('disconnect',", "        socket.on('exitRoom',"), context);
        if (mode === 'queued_error' || mode === 'member_error') {
            if (mode === 'queued_error') rooms.clear();
            socket.use((packet, next) => next(new Error('fixture error')));
        }
        socket.on('vote', (_, ack) => {
            calls++;
            if (typeof ack === 'function') ack({ ok: true });
        });
        socket.on('getBreakoutRoomsInfo', () => calls++);
        socket.on('getMeetingRecordingPolicy', (_, ack) => ack({ ready: true }));
    });
    let client;
    try {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        client = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
        const pending = new Map();
        let connected = false,
            closed = false;
        client.on('close', () => {
            closed = true;
        });
        client.on('error', (error) => {
            throw error;
        });
        client.on('message', (raw) => {
            const packet = String(raw);
            if (packet.startsWith('0')) client.send('40{"token":"live"}');
            else if (packet === '2') client.send('3');
            else if (packet.startsWith('40')) connected = true;
            else if (packet.startsWith('43')) {
                const match = /^43(\d+)(\[.*\])$/.exec(packet);
                if (match) pending.set(Number(match[1]), JSON.parse(match[2])[0]);
            }
        });
        for (let i = 0; i < 100 && !connected; i++) await wait(10);
        assert(connected, 'namespace connection timed out');
        const denied = mode === 'unadmitted' || mode === 'breakout';
        const staysConnected = denied || mode === 'valid';
        const event =
            mode === 'unadmitted' || mode === 'valid'
                ? 'vote'
                : mode === 'breakout'
                  ? 'getBreakoutRoomsInfo'
                  : 'getMeetingRecordingPolicy';
        // Send the entire burst without yielding, reproducing queued dispatch
        // callbacks racing with the first packet's disconnect cleanup.
        for (let i = 1; i <= 20; i++) {
            client.send('42' + i + JSON.stringify([event, { secret: 'secret-marker' }]));
        }
        for (let i = 0; i < 100 && (staysConnected ? pending.size < 20 : !closed); i++) await wait(10);
        await wait(30);
        assert.equal(calls, mode === 'valid' ? 20 : 0);
        if (mode === 'valid') {
            assert.equal(pending.size, 20);
            assert([...pending.values()].every((value) => value.ok === true));
            assert.equal(closed, false);
            assert.equal(errors.length, 0);
            assert.equal(logs.length, 0);
        } else if (denied) {
            assert.equal(pending.size, 20);
            assert.equal(errors.length, 0);
            assert.equal(closed, false);
            assert.equal(logs.length, 20);
            const reason = mode === 'unadmitted' ? 'not_admitted' : 'breakout_disabled';
            assert(logs.every((entry) => entry.reason === reason));
            for (const entry of logs)
                assert.deepEqual(Object.keys(entry).sort(), ['component', 'event', 'ip', 'reason', 'timestamp']);
            assert(!JSON.stringify(logs).includes('secret-marker'));
        } else {
            assert.equal(closed, true);
            assert.equal(releases, 1);
            assert(sockets[0].listenerCount('error') > 0, 'disconnect removed the error listener');
            assert.equal(sockets[0].listenerCount('vote'), 0);
            assert.equal(sockets[0].listenerCount('disconnect'), 0);
            if (mode === 'queued_error' || mode === 'member_error') assert.equal(errors.length, 1);
            else {
                assert.equal(errors.length, 0);
                assert(
                    logs.some((entry) => entry.reason === (mode === 'expired' ? 'session_expired' : 'invalid_session'))
                );
            }
            if (mode !== 'queued_error') {
                assert.equal(removed, 1);
                assert.equal(deliveries, 1);
            }
        }
        console.log(JSON.stringify({ mode, ok: true }));
    } finally {
        client?.terminate();
        await new Promise((resolve) => io.close(resolve));
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
