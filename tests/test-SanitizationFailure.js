'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');

function failingSanitizer() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app/src/XSS'), 'utf8'), {
        module,
        require: (name) =>
            name === 'jsdom'
                ? require(name)
                : name === 'dompurify'
                  ? () => ({
                        setConfig() {},
                        addHook() {},
                        sanitize() {
                            throw Error('secret-client-payload');
                        },
                    })
                  : name === './Logger'
                    ? class {
                          error() {
                              throw Error('Must not log payload');
                          }
                      }
                    : require(name),
    });
    return module.exports;
}

describe('sanitizer failure boundaries', () => {
    it('guards every production Socket.IO sanitizer call before using the result', () => {
        const source = fs.readFileSync(require.resolve('../app/src/Server'), 'utf8');
        const socket = source.slice(source.indexOf("    io.on('connection', (socket) => {"));
        const calls = [...socket.matchAll(/checkXSS\((?:dataObject|parsed)\)/g)];
        assert.equal(calls.length, 31);
        for (const call of calls) {
            const after = socket.slice(call.index, call.index + 230);
            assert.match(
                after,
                /catch \{\s*securityEvent\('socket_event_rejected', socket, 'sanitization_failed'\);\s*return;/
            );
        }
    });
    it('throws a fixed error rather than returning any original or partially sanitized payload', () => {
        const sanitize = failingSanitizer();
        for (const input of ['<img src=x onerror=alert(1)>', { nested: ['secret-client-payload'] }]) {
            assert.throws(
                () => sanitize(input),
                (error) =>
                    error.code === 'SANITIZATION_FAILED' &&
                    error.message === 'Sanitization failed' &&
                    !error.stack.includes('secret-client-payload')
            );
        }
    });

    it('rejects an HTTP operation before its side effect and keeps the server usable', async () => {
        const app = express(),
            sanitize = failingSanitizer();
        let effects = 0;
        app.use(express.json());
        app.post('/operation', async (req, res) => {
            sanitize(req.body);
            effects++;
            res.sendStatus(204);
        });
        app.get('/health', (_req, res) => res.send('ok'));
        app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        try {
            const base = 'http://127.0.0.1:' + server.address().port;
            const response = await fetch(base + '/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"value":"secret-client-payload"}',
            });
            assert.equal(response.status, 500);
            assert.equal(effects, 0);
            assert.doesNotMatch(await response.text(), /secret-client-payload/);
            assert.equal(await (await fetch(base + '/health')).text(), 'ok');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
