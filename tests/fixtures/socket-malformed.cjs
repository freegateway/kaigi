'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const guard = require('../../app/src/SocketEventGuard');
const source = fs.readFileSync(require.resolve('../../app/src/Server'), 'utf8');
const mode = process.argv[2];
const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a >= 0 && b > a);
    return source.slice(a, b);
};

async function main() {
    const server = http.createServer(), io = new Server(server, { transports: ['websocket'] });
    const logs = [], clients = [], rooms = new Map();
    let cleanup = 0, countCalls = 0;
    const room = { getPeer: () => ({}), getPeersCount: () => ++countCalls };
    rooms.set('meeting', room);
    io.on('connection', socket => {
        socket.authSessionId = 'live';
        socket.authenticatedMeeting = mode !== 'unadmitted';
        socket.room_id = 'meeting';
        const context = {
            socket, recordingCapabilities: { attach() {} },
            require: name => { assert.equal(name, './SocketEventGuard'); return guard; },
            roomList: rooms, requireAuthSession() {},
            securityEvent: (event, _socket, reason) => logs.push({ event, reason }),
            roomExists: () => {
                if (mode === 'sync' && socket.handshake.auth.bad) throw Error('private-token-marker');
                return true;
            },
            getRoom: () => {
                if (mode === 'async' && socket.handshake.auth.bad) throw Error('private-token-marker');
                return room;
            },
            log: { debug() {}, error() {} },
        };
        vm.runInNewContext(section("    io.on('connection', (socket) => {", "        socket.on('getMeetingRecordingPolicy'") + '\n});', { io: { on: (_event, fn) => fn(socket) }, ...context });
        vm.runInNewContext(section("        socket.on('getPeerCounts',", "        socket.on('cmd',"), context);
        vm.runInNewContext(section("        socket.on('createRoom',", "        socket.on('join',"), context);
        // This synchronous production handler throws outside its local try block.
        vm.runInNewContext(section("        socket.on('getRouterRtpCapabilities',", "        socket.on('createWebRtcTransport',"), context);
        socket.on('disconnect', () => cleanup++);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    async function connect(bad) {
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
        clients.push(ws);
        let sequence = 0;
        const pending = new Map();
        await new Promise((resolve, reject) => {
            ws.on('error', reject);
            ws.on('message', raw => {
                const frame = String(raw);
                if (frame.startsWith('0')) ws.send('40' + JSON.stringify({ bad }));
                else if (frame.startsWith('40')) resolve();
                else if (frame === '2') ws.send('3');
                else if (frame.startsWith('43')) {
                    const match = /^43(\d+)(.*)$/.exec(frame);
                    pending.get(Number(match[1]))?.(JSON.parse(match[2])[0]);
                    pending.delete(Number(match[1]));
                }
            });
        });
        return {
            ws,
            send: (event, args = [], ack = true) => new Promise(resolve => {
                const id = ack ? ++sequence : '';
                if (ack) pending.set(id, resolve);
                ws.send('42' + id + JSON.stringify([event, ...args]));
                if (!ack) resolve();
            }),
        };
    }
    try {
        const bad = await connect(true), other = await connect(false);
        if (mode === 'sync' || mode === 'async') {
            const event = mode === 'sync' ? 'getRouterRtpCapabilities' : 'getPeerCounts';
            assert.deepEqual(await bad.send(event, [{}]), { error: 'Invalid request' });
            await new Promise(resolve => setTimeout(resolve, 20));
            assert.equal(cleanup, 1);
            assert.deepEqual(await other.send('getPeerCounts', [{}]), { peerCounts: 1 });
        } else if (mode === 'unadmitted') {
            assert.deepEqual(await bad.send('getPeerCounts', [{}]), { error: 'Not in meeting' });
            assert.deepEqual(await bad.send('createRoom', [null]), { error: 'Invalid request' });
            assert.equal(countCalls, 0);
        } else {
            for (const args of [[], [null], [17], ['private-token-marker'], [[]], [{}, 'bad-ack']])
                assert.deepEqual(await bad.send('getPeerCounts', args), { error: 'Invalid request' });
            await bad.send('getPeerCounts', [{}], false);
            assert.deepEqual(await bad.send('createRoom', [{ room_id: 'meeting', peer_token: [], token: 1 }]), { error: 'Invalid request' });
            assert.deepEqual(await bad.send('getPeerCounts', [{}]), { peerCounts: 1 });
            assert.deepEqual(await other.send('getPeerCounts', [{}]), { peerCounts: 2 });
            assert.equal(cleanup, 0);
        }
        assert(logs.length > 0);
        assert(!JSON.stringify(logs).includes('private-token-marker'));
        assert(logs.every(row => /^[a-z_]+$/.test(row.reason)));
        console.log(JSON.stringify({ ok: true, mode }));
    } finally {
        for (const ws of clients) ws.terminate();
        await io.close();
    }
}
const timeout = setTimeout(() => { console.error('Test timed out'); process.exit(1); }, 4000);
main().then(() => clearTimeout(timeout)).catch(error => { console.error(error); process.exit(1); });
