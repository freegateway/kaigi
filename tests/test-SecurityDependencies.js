'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const sinon = require('sinon');
const qs = require('qs');
const Joi = require('joi');

describe('security dependency regressions', () => {
    async function withLimiter(run) {
        const app = express();
        const store = new MemoryStore();
        app.use(rateLimit({ windowMs: 1000, limit: 2, skipSuccessfulRequests: true, store }));
        let finish;
        let started;
        const pending = new Promise((resolve) => {
            started = resolve;
        });
        app.get('/slow', (_req, res) => {
            finish = () => res.end('ok');
            started();
        });
        app.get('/ok', (_req, res) => res.end('ok'));
        app.get('/failure', (_req, res) => res.status(401).end('denied'));
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        function request(path) {
            return new Promise((resolve, reject) => {
                const req = http.get({ host: '127.0.0.1', port: server.address().port, path, agent: false }, (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode));
                });
                req.setTimeout(2000, () => req.destroy(new Error('test request timed out')));
                req.on('error', reject);
            });
        }
        try {
            await run({ request, pending, finish: () => finish() });
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
            store.shutdown();
        }
    }

    it('does not subtract a previous-window success from current failed-login counts', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['Date'] });
        try {
            await withLimiter(async ({ request, pending, finish }) => {
                const old = request('/slow');
                await pending;
                clock.tick(1001);
                assert.equal(await request('/failure'), 401);
                assert.equal(await request('/failure'), 401);
                assert.equal(await request('/failure'), 429);
                finish();
                assert.equal(await old, 200);
                assert.equal(await request('/failure'), 429);
            });
        } finally {
            clock.restore();
        }
    });

    it('exempts ordinary successful responses but blocks repeated failures', async () => {
        await withLimiter(async ({ request }) => {
            for (let n = 0; n < 4; n++) assert.equal(await request('/ok'), 200);
            assert.equal(await request('/failure'), 401);
            assert.equal(await request('/failure'), 401);
            assert.equal(await request('/failure'), 429);
        });
    });

    it('filters bracket-wrapped prototype keys at depth zero', () => {
        assert.deepEqual(qs.parse('[toString]=bad&name=valid', { depth: 0 }), { name: 'valid' });
    });

    it('counts sparse-array elements rather than holes against the limit', () => {
        assert.deepEqual(qs.parse('a[]=new&a[19]=19&a[0]=0', { throwOnLimitExceeded: true }), {
            a: ['new', '19', '0'],
        });
    });

    it('preserves Unicode numeric entities and null-prototype containers', () => {
        assert.equal(qs.parse('a=%26%23128512%3B', { charset: 'iso-8859-1', interpretNumericEntities: true }).a, '😀');
        const parsed = qs.parse('a[]=x', { plainObjects: true, parseArrays: false });
        assert.equal(Object.getPrototypeOf(parsed.a), null);
    });

    it('rejects prototype message languages without altering Object.prototype', () => {
        const messages = JSON.parse('{"__proto__":{"number.min":"bad"}}');
        assert.throws(() => Joi.number().min(10).messages(messages), /Cannot use __proto__/);
        assert.equal(Object.prototype['number.min'], undefined);
    });

    it('does not overwrite prototype-named rename targets', () => {
        const result = Joi.object()
            .rename('a', 'constructor', { multiple: true })
            .unknown()
            .validate({ a: 'replacement', constructor: 'original' });
        assert.ok(result.error);
    });

    it('bounds multiple-email parsing in a subprocess', function () {
        this.timeout(5000);
        execFileSync(
            process.execPath,
            [
                '-e',
                "const Joi=require('joi'); const r=Joi.string().email({multiple:true}).validate(' '.repeat(100000)); if(!r.error)process.exit(1);",
            ],
            { cwd: __dirname + '/..', timeout: 2000, stdio: 'pipe' }
        );
    });
});
