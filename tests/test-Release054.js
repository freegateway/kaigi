'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const help = require('../app/src/Help');

describe('Kaigi 0.5.4 privacy and help', () => {
    it('renders localized print labels, static-illustration captions and branding', () => {
        for (const lang of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const document = new JSDOM(help.renderHelp({ site: { name: 'Example site' } }, lang)).window.document;
            const copy = require('../app/src/templates/HelpStrings.json')[lang === 'en-CA' ? 'en' : lang];
            assert.equal(document.getElementById('helpPrint').textContent, copy.HELP_PRINT_LABEL);
            assert(document.getElementById('helpPrint').hidden);
            assert(document.body.textContent.includes(copy.ILLUSTRATION));
            assert(document.body.textContent.includes('Example site'));
            assert.equal(document.querySelector('meta[name="robots"]').content, 'noindex, nofollow');
        }
    });

    it('uses crawler exclusions without altering title or preview metadata', async () => {
        const app = express();
        app.use(require('../app/src/middleware/CrawlerPolicy'));
        app.get('/login', (_req, res) => res.send('<title>Custom title</title>'));
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            const robots = await fetch(base + '/robots.txt');
            assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
            assert.equal((await fetch(base + '/sitemap.xml')).status, 404);
            const page = await fetch(base + '/login');
            assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
            assert.equal(await page.text(), '<title>Custom title</title>');
            const source = fs.readFileSync(path.join(__dirname, '../app/src/Server.js'), 'utf8');
            assert(source.indexOf("require('./middleware/CrawlerPolicy')") < source.indexOf('express.static(dir.public'));
        } finally { await new Promise(resolve => server.close(resolve)); }
    });

    it('retains 429 responses and forwards asynchronous limiter errors', async () => {
        const app = express();
        app.get('/normal', rateLimit({ windowMs: 60000, limit: 1 }), (_req, res) => res.send('ok'));
        app.get('/error', rateLimit({ windowMs: 60000, limit: 1, handler: async () => { throw new Error('expected'); } }), (_req, res) => res.send('ok'));
        app.use((error, _req, res, _next) => res.status(503).send(error.message));
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            assert.equal((await fetch(base + '/normal')).status, 200);
            assert.equal((await fetch(base + '/normal')).status, 429);
            assert.equal((await fetch(base + '/error')).status, 200);
            const error = await fetch(base + '/error');
            assert.equal(error.status, 503);
            assert.equal(await error.text(), 'expected');
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
});
