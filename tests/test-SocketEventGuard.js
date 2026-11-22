'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const guard = require('../app/src/SocketEventGuard');

describe('Socket.IO argument validation and exception containment', function () {
    this.timeout(15000);
    for (const mode of ['malformed', 'sync', 'async', 'unadmitted']) {
        it(`contains ${mode} production events without disrupting another connection`, () => {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/socket-malformed.cjs'), mode], {
                encoding: 'utf8', timeout: 8000,
            });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stdout + result.stderr);
            assert.equal(JSON.parse(result.stdout.trim()).ok, true);
        });
    }
    it('acknowledges once and cleans up after an unexpected failure without disclosing error text', async () => {
        const socket = new EventEmitter(), logs = [], replies = [];
        socket.disconnect = () => { socket.disconnected = true; };
        guard(socket, (...args) => logs.push([args[0], args[2]]));
        socket.on('getPeerCounts', (_data, ack) => { ack({ ok: true }); throw Error('private-token'); });
        socket.emit('getPeerCounts', {}, reply => replies.push(reply));
        assert.deepEqual(replies, [{ ok: true }]);
        assert.equal(socket.disconnected, true);
        assert.equal(JSON.stringify(logs).includes('private-token'), false);
    });
    it('preserves listener removal and bounds rejection logging', () => {
        const socket = new EventEmitter(), logs = [];
        guard(socket, (...args) => logs.push(args));
        const handler = () => assert.fail('removed listener ran');
        socket.on('message', handler);
        socket.removeListener('message', handler);
        socket.emit('message', {});
        socket.on('getPeerCounts', () => assert.fail('malformed listener ran'));
        for (let n = 0; n < 30; n++) socket.emit('getPeerCounts', null);
        assert.equal(logs.length, 10);
    });
});
