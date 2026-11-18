'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const http = require('node:http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
describe('WebSocket security dependency', () => {
    it('resolves every retained consumer to the patched ws', () => {
        for (const consumer of ['engine.io', 'socket.io-adapter']) {
            const r = createRequire(require.resolve(consumer));
            assert.equal(r('ws/package.json').version, '8.23.0');
        }
        const lock = require('../package-lock.json');
        for (const [name, data] of Object.entries(lock.packages)) if (name.endsWith('node_modules/ws')) assert.equal(data.version, '8.23.0');
    });
    it('terminates a connection when automatic Pong responses cannot drain', async () => {
        const server = http.createServer();
        const wss = new WebSocket.Server({ server, maxPendingAutoPongs: 2 });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
        try {
            const peer = await new Promise(resolve => wss.once('connection', resolve));
            await new Promise(resolve => client.once('open', resolve));
            const closed = new Promise(resolve => peer.once('close', resolve));
            // Hold server writes so auto-Pong completions remain pending; exercise real incoming Ping frames.
            peer._socket.cork();
            client._socket.cork();
            for (let n = 0; n < 8; n++) client.ping('ping');
            client._socket.uncork();
            await closed;
            assert(peer._pendingAutoPongs <= 2);
        } finally { client.terminate();wss.close(); await new Promise(resolve => server.close(resolve)); }
    });
    it('retains a finite auto-Pong limit on Engine.IO WebSockets', () => {
        const server = http.createServer(), io = new Server(server);
        assert.equal(io.engine.ws.options.maxPendingAutoPongs, 60);
        io.close();
    });
});
