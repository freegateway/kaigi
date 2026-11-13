'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const proxyquire = require('proxyquire').noCallThru();

async function withServer(app, action) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await action(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('login rate-limit dependency maintenance', () => {
    it('keeps concurrent successful logins uncounted while failed attempts reach the configured limit', async () => {
        const { createRateLimiters } = proxyquire('../app/src/middleware/RateLimiters', {
            '../config': { security: { host: { maxAttempts: 4, minBlockTime: 1 } } },
        });
        const { loginLimiter } = createRateLimiters({ getRequesterKey: () => 'test' });
        const app = express();
        app.use(express.json());
        app.post('/login', loginLimiter, (req, res) => res.sendStatus(req.body.ok ? 200 : 401));
        try {
            await withServer(app, async (url) => {
                const attempt = (ok) =>
                    fetch(url + '/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: 'account', ok }),
                    });
                for (let i = 0; i < 3; i++) {
                    const responses = await Promise.all([attempt(true), attempt(true)]);
                    assert(responses.every((response) => response.status === 200));
                    await tick();
                }
                assert.equal((await attempt(false)).status, 401);
                assert.equal((await attempt(false)).status, 401);
                const responses = await Promise.all([attempt(false), attempt(false)]);
                assert(responses.every((response) => response.status === 401));
                assert.equal((await attempt(false)).status, 429);
            });
        } finally {
            await loginLimiter.resetKey('account');
        }
    });
    it('does not return expired memory-store records and starts a fresh count', async () => {
        const store = new MemoryStore();
        store.init({ windowMs: 1000 });
        try {
            await store.increment('account');
            store.current.get('account').resetTime = new Date(0);
            assert.equal(await store.get('account'), undefined);
            assert.equal((await store.increment('account')).totalHits, 1);
        } finally {
            store.shutdown();
        }
    });
    it('does not subtract a late successful request from the next login window', async () => {
        const store = new MemoryStore();
        const limiter = rateLimit({
            windowMs: 60000,
            limit: 10,
            store,
            keyGenerator: () => 'account',
            skipSuccessfulRequests: true,
        });
        let release, started;
        const ready = new Promise((resolve) => {
            started = resolve;
        });
        const app = express();
        app.use(limiter);
        app.get('/slow', (_req, res) => {
            release = () => {
                if (!res.writableEnded) res.sendStatus(200);
            };
            started();
        });
        app.get('/failure', (_req, res) => res.sendStatus(401));
        const originalNow = Date.now;
        try {
            await withServer(app, async (url) => {
                const slow = fetch(url + '/slow');
                await ready;
                const nextWindow = store.current.get('account').resetTime.getTime() + 1;
                Date.now = () => nextWindow;
                assert.equal((await fetch(url + '/failure')).status, 401);
                assert.equal((await store.get('account')).totalHits, 1);
                release();
                assert.equal((await slow).status, 200);
                await tick();
                await tick();
                assert.equal((await store.get('account')).totalHits, 1);
            });
        } finally {
            Date.now = originalNow;
            release?.();
            store.shutdown();
        }
    });
    it('contains injected decrement and success-callback errors without unhandled rejections', async () => {
        for (const mode of ['decrement', 'callback']) {
            const errors = [],
                rejections = [];
            const handler = (error) => rejections.push(error);
            process.on('unhandledRejection', handler);
            const store = new MemoryStore();
            if (mode === 'decrement')
                store.decrement = async () => {
                    throw new Error('fixture failure');
                };
            const limiter = rateLimit({
                windowMs: 1000,
                limit: 10,
                store,
                skipSuccessfulRequests: true,
                requestWasSuccessful:
                    mode === 'callback'
                        ? async () => {
                              throw new Error('fixture failure');
                          }
                        : () => true,
                logger: { error: (...args) => errors.push(args), warn() {}, debug() {} },
            });
            const app = express();
            app.use(limiter);
            app.get('/', (_req, res) => res.sendStatus(200));
            try {
                await withServer(app, async (url) => {
                    assert.equal((await fetch(url)).status, 200);
                    await tick();
                    await tick();
                    assert.equal((await fetch(url)).status, 200);
                    await tick();
                    await tick();
                });
                assert.equal(errors.length, 2);
                assert.equal(rejections.length, 0);
            } finally {
                store.shutdown();
                process.off('unhandledRejection', handler);
            }
        }
    });
    it('decrements at most once when finish and close race', async () => {
        const store = new MemoryStore();
        let calls = 0;
        store.decrement = async () => {
            calls++;
            await tick();
        };
        const limiter = rateLimit({
            windowMs: 1000,
            limit: 10,
            store,
            skipSuccessfulRequests: true,
            skipFailedRequests: true,
        });
        const app = express();
        app.use(limiter);
        app.get('/', (_req, res) => {
            res.sendStatus(200);
            res.emit('error', new Error('fixture close'));
        });
        try {
            await withServer(app, async (url) => {
                assert.equal((await fetch(url)).status, 200);
                await tick();
                await tick();
            });
            assert.equal(calls, 1);
        } finally {
            store.shutdown();
        }
    });
});
