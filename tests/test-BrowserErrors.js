'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { JSDOM } = require('jsdom');
const { sendError } = require('../app/src/BrowserErrors');
describe('browser error responses', () => {
    let server, base;
    before(async () => {
        const app = express();
        app.use((req, res) => sendError(req, res, Number(req.query.status) || 404));
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => new Promise(resolve => server.close(resolve)));
    for (const status of [400, 403, 404, 500]) it(`renders ${status} without scripts, with a root link and absolute assets`, async () => {
        const res = await fetch(`${base}/nested/missing?status=${status}`, { headers: { Accept: 'text/html', 'Accept-Language': 'ja' } });
        assert.equal(res.status, status);
        assert.match(res.headers.get('content-type'), /text\/html/);
        assert.equal(res.headers.get('content-language'), 'ja');
        const dom = new JSDOM(await res.text());
        assert.equal(dom.window.document.querySelector('a').getAttribute('href'), '/');
        assert.equal(dom.window.document.querySelector('link').getAttribute('href'), '/css/errors.css');
        assert.equal(dom.window.document.querySelectorAll('script').length, 0);
        assert.match(dom.window.document.body.textContent, /ログイン/);
    });
    it('keeps /login retired and returns JSON for API requests', async () => {
        const html = await fetch(`${base}/login`, { headers: { Accept: 'text/html', 'Accept-Language': 'fr-CA' } });
        assert.equal(html.status, 404);
        assert.match(await html.text(), /Page introuvable/);
        const api = await fetch(`${base}/api/missing`, { headers: { Accept: 'text/html' } });
        assert.equal(api.status, 404);
        assert.equal((await api.json()).status, 404);
    });
    it('falls back safely for untrusted languages and omits error details', async () => {
        const res = await fetch(`${base}/%3Cscript%3E`, { headers: { Accept: 'text/html', 'Accept-Language': 'zz' } });
        assert.equal(res.status, 404);
        assert.match(await res.text(), /Page not found/);
		const login = await fetch(`${base}/missing`, { headers: { Accept: 'text/html', 'Accept-Language': 'en-CA' } });
		const page = new JSDOM(await login.text());
		assert.equal(page.window.document.querySelector('a').textContent, 'Return to login');
    });
});
