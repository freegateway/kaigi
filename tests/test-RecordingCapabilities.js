'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const makeCapabilities = require('../app/src/RecordingCapabilities');

describe('recording file capabilities over Socket.IO and HTTP', function () {
    this.timeout(6000);
    let io, server, ws, base, state, rooms, room, pending, sequence;
    beforeEach(async () => {
        state = { enabled: true, allowed: true, live: true, admitted: true, data: new Map() };
        room = { sessionId: 'conference-1', getPeer: () => state.admitted ? {} : null };
        rooms = new Map([['meeting', room]]);
        const app = express();
        const caps = makeCapabilities({ key: 'test-recording-signing-key-with-32-characters', expiresIn: '1h', rooms,
            requireSession: id => { assert(state.live); assert.equal(id, 'login-1'); return { id }; },
            allowsRoom: async () => state.allowed, recordingAllowed: () => state.enabled, enabled: true });
        app.post('/recSync', caps.authorize, express.raw({ type: 'application/octet-stream' }), (req, res) => {
            state.data.set(req.query.fileName, Buffer.concat([state.data.get(req.query.fileName) || Buffer.alloc(0), req.body]));
            res.json({ ok: true });
        });
        app.post('/recSyncFixWebm', caps.authorize, (_req, res) => res.json({ ok: true }));
        server = http.createServer(app); io = new Server(server, { transports: ['websocket'] });
        io.on('connection', socket => { socket.authSessionId = 'login-1'; socket.room_id = 'meeting'; socket.authenticatedMeeting = state.admitted; caps.attach(socket); });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`; pending = new Map(); sequence = 0;
        ws = new WebSocket(base.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
        await new Promise((resolve, reject) => {
            ws.on('error', reject);
            ws.on('message', raw => {
                const p = String(raw);
                if (p.startsWith('0')) ws.send('40');
                else if (p === '2') ws.send('3');
                else if (p.startsWith('40')) resolve();
                else if (p.startsWith('43')) { const m = /^43(\d+)(.*)$/.exec(p); pending.get(+m[1])?.(JSON.parse(m[2])[0]); pending.delete(+m[1]); }
            });
        });
    });
    afterEach(async () => { ws?.terminate(); await new Promise(resolve => io.close(resolve)); });
    const issue = () => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); ws.send(`42${id}["getRecUploadToken",{}]`); });
    const post = (c, file = c.fileName, route = '/recSync', bytes = 'chunk') => fetch(`${base}${route}?fileName=${encodeURIComponent(file)}`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
    it('issues distinct opaque filenames and accepts ordered chunks only for their own file', async () => {
        const a = await issue(), b = await issue();
        assert.notEqual(a.fileName, b.fileName); assert.doesNotMatch(a.fileName, /meeting|conference/);
        assert.equal((await post(a, b.fileName)).status, 403);
        assert.equal((await post(a, '../file.webm')).status, 403);
        assert.equal((await post(a, a.fileName, '/recSync', 'one')).status, 200);
        assert.equal((await post(a, a.fileName, '/recSync', 'two')).status, 200);
        assert.equal(String(state.data.get(a.fileName)), 'onetwo');
        assert.equal((await post(a, a.fileName, '/recSyncFixWebm')).status, 200);
        assert.equal((await post(a)).status, 403);
        assert.equal((await post(b)).status, 200);
    });
    it('denies revoked sessions, recreated conferences, removed grants and disabled recording', async () => {
        const c = await issue();
        state.live = false; assert.equal((await post(c)).status, 403); state.live = true;
        room.sessionId = 'conference-2'; assert.equal((await post(c)).status, 403); room.sessionId = 'conference-1';
        state.allowed = false; assert.equal((await post(c)).status, 403); state.allowed = true;
        state.enabled = false; assert.equal((await post(c)).status, 403);
        assert.equal((await issue()).error, 'Recording not authorized');
    });
    it('rejects issuance by unadmitted sockets and HTTP tokens not issued for a recording', async () => {
        state.admitted = false; assert.equal((await issue()).error, 'Recording not authorized');
        const bad = await fetch(base + '/recSync?fileName=test', { method: 'POST', headers: { Authorization: 'Bearer invalid' } });
        assert.equal(bad.status, 403); assert.deepEqual(await bad.json(), { error: 'Recording upload not authorized' });
    });
});
