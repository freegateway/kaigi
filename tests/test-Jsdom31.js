'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { JSDOM } = require('jsdom');
const sanitize = require('../app/src/XSS');

describe('jsdom 31 resource and sanitizer boundaries', () => {
    it('keeps default parsing inert and synchronous without fetching embedded resources', async () => {
        let requests = 0;
        const server = http.createServer((_req, res) => {
            requests++;
            res.end('window.executed = true');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const url = 'http://127.0.0.1:' + server.address().port + '/resource';
        const document = new JSDOM(
            `<script src="${url}"></script><link rel="stylesheet" href="${url}"><img src="${url}"><iframe src="${url}"></iframe><p id="tail">complete</p>`
        );
        try {
            assert.equal(document.window.document.getElementById('tail').textContent, 'complete');
            assert.equal(document.window.executed, undefined);
            const safe = sanitize(
                `<img src="${url}" onerror="secret()"><script>secret()</script><svg onload="secret()"></svg>`
            );
            assert.doesNotMatch(safe, /onerror|onload|script|secret/);
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.equal(requests, 0);
            const lock = require('../package-lock.json');
            assert.equal(
                Object.keys(lock.packages).some((name) => name.includes('@napi-rs/canvas')),
                false
            );
        } finally {
            document.window.close();
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('preserves malformed nested markup and encoded-URI sanitization boundaries', () => {
        for (const payload of [
            '<svg><g/onload=alert(1)//<p>',
            '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
            '<a href="&#106;avascript:alert(1)">link</a>',
            '%3Cimg%20src=x%20onerror=alert(1)%3E',
        ]) {
            const result = sanitize({ nested: [payload] });
            const dom = new JSDOM(result.nested[0]);
            assert.equal(
                dom.window.document.querySelector('script, [onerror], [onload], a[href^="javascript:"]'),
                null
            );
            dom.window.close();
        }
    });

    it('strips tuple-form authorization headers across an Undici redirect', async () => {
        const { Agent, interceptors, request } = require('node:module').createRequire(require.resolve('jsdom'))(
            'undici'
        );
        let received;
        const target = http.createServer((req, res) => {
            received = req.headers;
            res.end('ok');
        });
        const origin = http.createServer((_req, res) => {
            res.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port + '/' });
            res.end();
        });
        await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
        await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
        // The outer interceptor normalizes tuple headers before the redirect hop.
        const dispatcher = new Agent().compose([
            interceptors.deduplicate(),
            interceptors.redirect({ maxRedirections: 2 }),
        ]);
        try {
            const response = await request('http://127.0.0.1:' + origin.address().port + '/', {
                dispatcher,
                headers: [
                    ['Authorization', 'secret-test-value'],
                    ['X-Test', 'preserved'],
                ],
            });
            assert.equal(await response.body.text(), 'ok');
            assert.equal(received.authorization, undefined);
            assert.equal(received['x-test'], 'preserved');
        } finally {
            await dispatcher.close();
            await Promise.all([origin, target].map((server) => new Promise((resolve) => server.close(resolve))));
        }
    });
});
