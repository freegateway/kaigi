'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const source = fs.readFileSync(path.join(__dirname, '../app/src/Server.js'), 'utf8');
function section(start, end) {
    const a = source.indexOf(start),
        b = source.indexOf(end, a + start.length);
    assert(a >= 0 && b > a, start);
    return source.slice(a, b);
}

describe('server reconnect authorization boundaries', () => {
    it('revalidates live sessions and exact grants when an opaque meeting page is reloaded', async () => {
        const app = express(),
            sessions = new Map();
        const sessionId = '11111111-1111-1111-1111-111111111111';
        const selection = '22222222-2222-2222-2222-222222222222';
        const session = {
            source: 'local',
            username: 'attendee',
            allowed: true,
            meetingSelections: new Map([[selection, 'approved']]),
        };
        sessions.set(sessionId, session);
        const context = vm.createContext({
            app,
            getIP: () => '127.0.0.1',
            hostCfg: { users: [{ username: 'attendee' }] },
            requireAuthSession: (id) => {
                const found = sessions.get(id);
                if (!found) throw Error('Revoked');
                return found;
            },
            sessionAllowsRoom: async (current, meeting) => current.allowed && meeting === 'approved',
            log: { warn() {} },
            views: { room: 'room' },
            htmlInjector: { injectHtml: (_view, res) => res.send('authorized meeting page') },
        });
        vm.runInContext(section('    const navigationCookie =', "    app.post('/auth/meeting/create-token'"), context);
        vm.runInContext(section("    app.get('/meeting',", '    // Direct meeting-name URLs'), context);
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        async function request(ref = selection) {
            return new Promise((resolve, reject) => {
                http.get(
                    {
                        host: '127.0.0.1',
                        port: server.address().port,
                        path: '/meeting?selection=' + ref,
                        headers: { Cookie: '__Host-mirotalk_session=' + sessionId },
                    },
                    (res) => {
                        res.resume();
                        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
                    }
                ).on('error', reject);
            });
        }
        try {
            assert.equal((await request()).status, 200);
            assert.equal((await request('33333333-3333-3333-3333-333333333333')).status, 403);
            session.allowed = false;
            assert.equal((await request()).status, 403);
            session.allowed = true;
            sessions.clear();
            assert.deepEqual(await request(), { status: 302, location: '/login' });
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('rejects a reconnect handshake after session revocation', async () => {
        const server = http.createServer(),
            io = new Server(server, { transports: ['websocket'] });
        let live = true;
        vm.runInNewContext(section('    io.use((socket, next) => {', "    io.on('connection'"), {
            io,
            securityEvent() {},
            authenticatedSession: (token) => {
                if (!live || token !== 'fixture') throw Error('Revoked');
                return { id: 'live' };
            },
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        async function connect() {
            return new Promise((resolve, reject) => {
                const ws = new WebSocket(
                    `ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`
                );
                const timer = setTimeout(() => {
                    ws.terminate();
                    reject(Error('Handshake timeout'));
                }, 2000);
                ws.on('error', reject);
                ws.on('message', (raw) => {
                    const frame = String(raw);
                    if (frame.startsWith('0')) ws.send('40{"token":"fixture"}');
                    else if (frame.startsWith('40') || frame.startsWith('44')) {
                        clearTimeout(timer);
                        ws.terminate();
                        resolve(frame);
                    }
                });
            });
        }
        try {
            assert.match(await connect(), /^40/);
            live = false;
            assert.match(await connect(), /^44.*Authentication required/);
        } finally {
            await io.close();
        }
    });
});

describe('planned shutdown notification ordering', () => {
    it('notifies a real Socket.IO client before closing media, then drops transports without namespace disconnect', async () => {
        const server = http.createServer(),
            io = new Server(server, { transports: ['websocket'] });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`),
            frames = [],
            events = [];
        await new Promise((resolve, reject) => {
            ws.on('error', reject);
            ws.on('message', (raw) => {
                const frame = String(raw);
                frames.push(frame);
                if (frame.startsWith('0')) ws.send('40');
                else if (frame.startsWith('40')) resolve();
                else if (frame.includes('serverShutdown')) events.push('notice');
            });
        });
        const room = {
            isRtmpFileStreamerActive: () => false,
            isRtmpUrlStreamerActive: () => false,
            getPeers: () => new Map([['peer', {}]]),
            removePeer: () => events.push('media-close'),
        };
        const context = vm.createContext({
            server,
            io,
            roomList: new Map([['meeting', room]]),
            streams: {},
            workers: [{ close: () => events.push('worker-close') }],
            htmlInjector: { cleanup: () => events.push('cleanup') },
            config: {},
            log: { info() {}, debug() {}, warn() {}, error() {} },
            process: { exit: (code) => events.push(['exit', code]) },
            setTimeout: (callback, ms) => {
                assert.equal(ms, 1000);
                return setTimeout(callback, 30);
            },
        });
        vm.runInContext(section('let isShuttingDown = false;', '// Set a timeout for forced shutdown'), context);
        try {
            await vm.runInContext("gracefulShutdown('SIGTERM')", context);
            assert(events.indexOf('notice') >= 0);
            assert(events.indexOf('notice') < events.indexOf('media-close'));
            assert(events.indexOf('media-close') < events.indexOf('worker-close'));
            assert.equal(frames.includes('41'), false);
            assert.deepEqual(events.at(-1), ['exit', 0]);
        } finally {
            ws.terminate();
            await io.close();
        }
    });

    it('ignores duplicate signals briefly but still supports a later forced exit', async () => {
        let resume,
            now = 1000;
        const exits = [];
        const context = vm.createContext({
            Date: { now: () => now },
            server: { close() {} },
            io: { emit() {}, close: async () => {} },
            roomList: new Map(),
            streams: {},
            workers: [],
            htmlInjector: { cleanup() {} },
            config: {},
            log: { info() {}, debug() {}, warn() {}, error() {} },
            process: { exit: (code) => exits.push(code) },
            setTimeout: (callback) => {
                resume = callback;
            },
        });
        vm.runInContext(section('let isShuttingDown = false;', '// Set a timeout for forced shutdown'), context);
        const closing = vm.runInContext("gracefulShutdown('SIGINT')", context);
        await vm.runInContext("gracefulShutdown('SIGINT')", context);
        assert.deepEqual(exits, []);
        now = 4000;
        await vm.runInContext("gracefulShutdown('SIGTERM')", context);
        assert.deepEqual(exits, [1]);
        resume();
        await closing;
    });
});
