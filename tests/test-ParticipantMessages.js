'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const register = require('../app/src/ParticipantMessages');
const source = fs.readFileSync(require.resolve('../app/src/Server'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('participant message boundaries over real Socket.IO frames', function () {
    this.timeout(5000);
    let io, server, clients, rooms, logs, sockets;
    beforeEach(async () => {
        server = http.createServer();
        io = new Server(server, { transports: ['websocket'] });
        logs = [];
        clients = [];
        sockets = new Map();
        rooms = new Map();
        for (const name of ['meeting', 'other']) {
            const room = {
                peers: new Map(),
                getPeers() {
                    return this.peers;
                },
                getPeer(id) {
                    return this.peers.get(id);
                },
                sendTo(id, event, data) {
                    if (this.peers.has(id)) io.to(id).emit(event, data);
                },
                broadCast(from, event, data) {
                    for (const id of this.peers.keys()) if (id !== from) this.sendTo(id, event, data);
                },
            };
            rooms.set(name, room);
        }
        const securityEvent = (...args) => logs.push(args);
        vm.runInNewContext(section('    io.use((socket, next) => {', "    io.on('connection'"), {
            io,
            securityEvent,
            authenticatedSession: (token) => {
                if (!token) throw Error('session');
                return { id: token };
            },
        });
        io.on('connection', (socket) => {
            const { name, room: roomName = 'meeting', admitted = true } = socket.handshake.auth;
            socket.room_id = roomName;
            socket.authenticatedMeeting = admitted;
            const room = rooms.get(roomName);
            room.peers.set(socket.id, { peer_name: name, peer_avatar: false });
            sockets.set(name, socket);
            vm.runInNewContext(section('        socket.use((packet, next) => {', "        socket.on('clientError'"), {
                socket,
                roomList: rooms,
                securityEvent,
                requireAuthSession: (id) => {
                    if (id === 'revoked') throw Error('expired');
                },
            });
            register(socket, {
                getRoom: () => room,
                getPeer: () => room.getPeer(socket.id),
                securityEvent,
                checkXSS: (data) => { if (socket.handshake.auth.failSanitizer) throw Error('private payload'); return data; },
                isValidFileName: (name) => typeof name === 'string' && !name.includes('/'),
            });
            socket.on('getMeetingRecordingPolicy', (_, ack) => ack(true));
            socket.on('disconnect', () => room.peers.delete(socket.id));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    it('drops file announcements on sanitizer failure without relaying or killing the connection', async () => {
        const sender = await connect('sender', { failSanitizer: true });
        const receiver = await connect('receiver');
        sender.send('fileInfo', { fileName: 'private payload', broadcast: true });
        await sender.barrier();
        await receiver.barrier();
        assert.equal(receiver.events.filter(([name]) => name === 'fileInfo').length, 0);
        assert(logs.some(([event, , reason]) => event === 'socket_event_rejected' && reason === 'sanitization_failed'));
        assert(!JSON.stringify(logs.map(([event, , reason]) => [event, reason])).includes('private payload'));
    });

    afterEach(async () => {
        for (const client of clients) client.ws.terminate();
        await new Promise((resolve) => io.close(resolve));
    });
    async function connect(name, extra = {}) {
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
        let ack = 0;
        const pending = new Map(),
            events = [];
        const client = {
            ws,
            events,
            send: (event, payload) => {
                if (event === 'file' && typeof payload.fileData === 'string') {
                    ws.send('451-' + JSON.stringify([event, { ...payload, fileData: { _placeholder: true, num: 0 } }]));
                    ws.send(Buffer.from(payload.fileData));
                } else ws.send('42' + JSON.stringify([event, payload]));
            },
            barrier: () =>
                new Promise((resolve) => {
                    const id = ++ack;
                    pending.set(id, resolve);
                    ws.send('42' + id + JSON.stringify(['getMeetingRecordingPolicy', {}]));
                }),
        };
        clients.push(client);
        await new Promise((resolve, reject) => {
            ws.on('error', reject);
            let binaryEvent;
            ws.on('message', (raw, isBinary) => {
                if (isBinary) {
                    assert(binaryEvent);
                    // Inspect decoded attachment bytes as text for these fixtures.
                    binaryEvent[1].fileData = raw.toString();
                    events.push(binaryEvent);
                    binaryEvent = null;
                    return;
                }
                const packet = String(raw);
                if (packet.startsWith('0')) ws.send('40' + JSON.stringify({ token: name, name, ...extra }));
                else if (packet === '2') ws.send('3');
                else if (packet.startsWith('40')) resolve();
                else if (packet.startsWith('42')) events.push(JSON.parse(packet.slice(2)));
                else if (packet.startsWith('451-')) binaryEvent = JSON.parse(packet.slice(4));
                else if (packet.startsWith('43')) {
                    const m = /^43(\d+)(.*)$/.exec(packet);
                    pending.get(Number(m[1]))?.(JSON.parse(m[2]));
                }
            });
        });
        return client;
    }
    it('stamps announcement/chunk identity and cannot redirect chunks into another meeting', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob'),
            c = await connect('Carol', { room: 'other' });
        a.send('fileInfo', {
            broadcast: true,
            fileName: 'a.txt',
            peer_name: 'Carol',
            sender_id: sockets.get('Carol').id,
        });
        a.send('file', { peer_id: sockets.get('Carol').id, sender_id: 'fake', fileData: 'payload' });
        await a.barrier();
        await b.barrier();
        await c.barrier();
        assert.equal(b.events[0][1].peer_name, 'Alice');
        assert.equal(b.events[0][1].sender_id, sockets.get('Alice').id);
        assert.deepEqual(b.events[1][1], { fileData: 'payload', sender_id: sockets.get('Alice').id });
        assert.equal(c.events.length, 0);
    });
    it('an unrelated peer cannot inject chunks or cancel another sender transfer', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob'),
            c = await connect('Carol');
        a.send('fileInfo', { peer_id: sockets.get('Bob').id, fileName: 'a.txt' });
        await a.barrier();
        await b.barrier();
        b.events.length = 0;
        c.send('file', { peer_id: sockets.get('Bob').id, sender_id: sockets.get('Alice').id, fileData: 'fake' });
        c.send('fileAbort', { sender_id: sockets.get('Alice').id });
        await c.barrier();
        await b.barrier();
        assert.equal(b.events.length, 0);
        a.send('file', { fileData: 'real' });
        await a.barrier();
        await b.barrier();
        assert.equal(b.events[0][1].fileData, 'real');
    });
    it('receiver cancellation removes only that recipient', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob'),
            c = await connect('Carol');
        a.send('fileInfo', { broadcast: true, fileName: 'a.txt' });
        await a.barrier();
        await b.barrier();
        await c.barrier();
        b.events.length = 0;
        c.events.length = 0;
        b.send('receiveFileAbort', { peer_id: sockets.get('Alice').id });
        await b.barrier();
        a.send('file', { fileData: 'still-sharing' });
        await a.barrier();
        await b.barrier();
        await c.barrier();
        assert.equal(b.events.length, 0);
        assert.equal(c.events.length, 1);
    });
    it('denies editor control and unsolicited replacement but preserves edits and clean attribution', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob');
        for (const action of ['lock', 'unlock', 'open', 'close', 'bogus'])
            a.send('editorActions', { action, peer_name: 'Bob' });
        a.send('editorUpdate', { ops: [{ insert: 'replacement' }] });
        await a.barrier();
        await b.barrier();
        assert.equal(b.events.length, 0);
        a.send('editorChange', { ops: [{ insert: 'edit' }] });
        a.send('editorActions', { action: 'clean', peer_name: 'Bob' });
        await a.barrier();
        await b.barrier();
        assert.equal(b.events.length, 2);
        assert.equal(b.events[1][1].peer_name, 'Alice');
        assert(logs.some((args) => args[2] === 'editor_action_denied'));
    });
    it('accepts only one requested snapshot from the chosen donor for the new member', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob'),
            c = await connect('Carol');
        b.send('editorReady');
        await b.barrier();
        await a.barrier();
        const requestId = a.events.find((e) => e[0] === 'editorSnapshotRequest')[1].requestId;
        c.send('editorUpdate', { requestId, content: { ops: [{ insert: 'fake' }] } });
        await c.barrier();
        a.send('editorUpdate', { requestId, content: { ops: [{ insert: 'snapshot' }] } });
        await a.barrier();
        await b.barrier();
        await c.barrier();
        assert.equal(b.events.filter((e) => e[0] === 'editorUpdate').length, 1);
        assert.equal(c.events.filter((e) => e[0] === 'editorUpdate').length, 0);
        a.send('editorUpdate', { requestId, content: { ops: [] } });
        await a.barrier();
        await b.barrier();
        assert.equal(b.events.filter((e) => e[0] === 'editorUpdate').length, 1);
    });
    it('production admission gate rejects file and editor operations before admission', async () => {
        const a = await connect('Alice', { admitted: false }),
            b = await connect('Bob');
        for (const event of ['fileInfo', 'file', 'editorChange', 'editorReady'])
            a.send(event, { broadcast: true, fileName: 'a.txt', ops: [] });
        await a.barrier();
        await b.barrier();
        assert.equal(b.events.length, 0);
        assert(logs.some((args) => args[2] === 'not_admitted'));
    });
    it('revoked sessions cannot relay file/editor messages', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob');
        sockets.get('Alice').authSessionId = 'revoked';
        const closed = new Promise((resolve) => a.ws.once('close', resolve));
        a.send('editorChange', { ops: [{ insert: 'denied' }] });
        await closed;
        await b.barrier();
        assert.equal(b.events.length, 0);
        assert(logs.some((args) => args[2] === 'session_expired'));
    });
    it('expired snapshot requests cannot replace a new member document', async () => {
        const a = await connect('Alice'),
            b = await connect('Bob');
        b.send('editorReady');
        await b.barrier();
        await a.barrier();
        const requestId = a.events.find((event) => event[0] === 'editorSnapshotRequest')[1].requestId;
        const now = Date.now();
        const clock = require('sinon')
            .stub(Date, 'now')
            .returns(now + 11000);
        try {
            a.send('editorUpdate', { requestId, content: { ops: [] } });
            await a.barrier();
            await b.barrier();
            assert.equal(b.events.length, 0);
        } finally {
            clock.restore();
        }
    });
});

describe('receiving browser DataChannel identity', () => {
    it('snapshot replies never read private editor contents', () => {
        const code = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
        const start = code.indexOf("        this.socket.on('editorSnapshotRequest',");
        const end = code.indexOf('\n        });', start) + '\n        });'.length;
        let handler, emitted;
        const context = {
            isEditorPrivate: true,
            collabEditorDelta: { ops: [{ insert: 'shared' }] },
            socket: {
                on: (_, fn) => {
                    handler = fn;
                },
                emit: (_, payload) => {
                    emitted = payload;
                },
            },
            quill: {
                getContents: () => {
                    throw Error('Private notes read');
                },
            },
        };
        vm.runInNewContext(code.slice(start, end), context);
        handler({ requestId: 'request' });
        assert.deepEqual(emitted.content, context.collabEditorDelta);
    });
    it('receiver chunk/abort guards reject other senders and preserve its active transfer', () => {
        const code = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
        for (const [field, handler] of [
            ['handleFileData', 'handleFile'],
            ['handleFileAbortData', 'handleFileAbort'],
        ]) {
            const start = code.indexOf(`    ${field} = `) + `    ${field} = `.length;
            const end = code.indexOf('\n    };', start) + '\n    }'.length;
            let calls = 0;
            const client = {
                receiveInProgress: true,
                incomingFileInfo: { sender_id: 'Alice' },
                [handler]: () => calls++,
            };
            vm.runInNewContext(`(${code.slice(start, end)}).call(null, { sender_id: 'Bob' });`, client);
            // Arrow functions capture the VM global object, which stands in for the receiving client.
            assert.equal(calls, 0);
            vm.runInNewContext(`(${code.slice(start, end)})({ sender_id: 'Alice' });`, client);
            assert.equal(calls, 1);
        }
    });
    it('uses producer ownership, not forged payload identity, and rejects missing ownership', async () => {
        const code = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
        const context = vm.createContext({ window: { location: { origin: 'https://example.test' } }, console });
        vm.runInContext(code + ';globalThis.Prototype = RoomClient.prototype;', context);
        let onMessage, shown;
        const client = Object.create(context.Prototype);
        Object.assign(client, {
            chatDataConsumers: new Map(),
            consumerTransport: {
                id: 't',
                consumeData: async () => ({
                    id: 'c',
                    on: (event, fn) => {
                        if (event === 'message') onMessage = fn;
                    },
                }),
            },
            socket: { request: async () => ({ id: 'c' }) },
            _moderator: {},
            showMessage: (message) => {
                shown = message;
            },
        });
        await client.consumeData('d');
        assert.equal(onMessage, undefined);
        await client.consumeData('d', { peer_id: 'real', peer_name: 'Alice', peer_avatar: false });
        onMessage(
            JSON.stringify({
                type: 'chat',
                peer_id: 'fake',
                peer_name: 'Bob',
                peer_avatar: 'https://outside.test/image',
                to_peer_id: 'all',
                peer_msg: 'hello',
            })
        );
        assert.equal(shown.peer_name, 'Alice');
        assert.equal(shown.peer_id, 'real');
        assert.equal(shown.peer_avatar, false);
    });
});
