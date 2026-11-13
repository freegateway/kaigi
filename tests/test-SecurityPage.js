'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const { JSDOM } = require('jsdom');
const security = require('../app/src/SecurityPage');
const help = require('../app/src/Help');
const { matchLanguage, requestLanguage } = require('../app/src/Locale');

describe('security page and initial browser language', () => {
    it('matches exact, regional and ordered locales, and falls back to English', () => {
        const available = ['en', 'en-CA', 'ja', 'fr-CA'];
        for (const [input, expected] of [
            [['ja-JP'], 'ja'],
            [['fr-CA'], 'fr-CA'],
            [['fr-FR'], 'fr-CA'],
            [['xx', 'ja'], 'ja'],
            [['en-CA'], 'en-CA'],
            [['zz'], 'en'],
            [[], 'en'],
        ])
            assert.equal(matchLanguage(input, available), expected);
        assert.equal(requestLanguage({ headers: { 'accept-language': 'en;q=0.1,ja-JP;q=0.9' } }, available), 'ja');
        assert.equal(requestLanguage({ headers: { 'accept-language': 'ja;q=0,en;q=1' } }, available), 'en');
        assert.equal(matchLanguage(['ja'], ['fr-CA']), 'en');
    });

    it('keeps approved English prose intact and provides complete maintained translations', () => {
        const root = new JSDOM(security.renderSecurity()).window.document;
        assert.equal(root.querySelectorAll('main > ul > li').length, 3);
        assert.equal(root.querySelectorAll('main h2').length, 6);
        assert(root.body.textContent.includes('knowing a meeting’s name'));
        assert(root.body.textContent.includes('Kaigi does not provide end-to-end encryption.'));
        for (const lang of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const doc = new JSDOM(security.renderSecurity({}, lang)).window.document;
            assert.equal(doc.documentElement.lang, lang);
            assert.equal(doc.querySelectorAll('main h2').length, 6);
            assert.equal(doc.querySelectorAll('main > ul > li').length, 3);
            assert.equal(doc.querySelectorAll('main p').length, root.querySelectorAll('main p').length);
            assert.equal(doc.querySelectorAll('script').length, 1);
            assert.equal(doc.querySelector('script').getAttribute('src'), '/js/Help.js');
            assert.equal(doc.querySelectorAll('img').length, 1);
        }
        assert.equal(new JSDOM(security.renderSecurity({}, 'de')).window.document.documentElement.lang, 'en');
    });

    it('projects only escaped public branding and rejects remote logo loads', () => {
        const doc = new JSDOM(
            security.renderSecurity({
                site: { name: '<img src=x>', logo: 'https://outside.invalid/tracker.svg' },
                password: 'private-password',
                users: ['private-user'],
            })
        ).window.document;
        assert.equal(doc.querySelector('.help-identity span').textContent, '<img src=x>');
        assert.equal(doc.querySelector('img').getAttribute('src'), '/images/logo.svg');
        assert(!doc.body.textContent.includes('private-password'));
        assert(!doc.body.textContent.includes('private-user'));
        assert(!doc.querySelector('[src^="https:"]'));
    });

    it('uses locale on direct HTTP visits without a session, including English fallback', async () => {
        const app = express();
        app.get('/security', security({ app: { language: 'fr-CA' } }));
        app.get('/help', help({ app: { language: 'fr-CA' } }));
        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            for (const route of ['/security', '/help']) {
                for (const [locale, expected] of [
                    ['ja-JP', 'ja'],
                    ['fr-CA', 'fr-CA'],
                    ['xx', 'en'],
                ]) {
                    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
                        headers: { 'Accept-Language': locale },
                    });
                    assert.equal(response.status, 200);
                    assert.equal(new JSDOM(await response.text()).window.document.documentElement.lang, expected);
                    assert(response.headers.get('content-security-policy').includes("connect-src 'none'"));
                    assert(response.headers.get('permissions-policy').includes('camera=()'));
                    assert.equal(response.headers.get('cache-control'), 'no-store');
                    assert.equal(response.headers.get('set-cookie'), null);
                }
            }
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('uses browser locale on landing and preserves a saved explicit choice', async () => {
        const source = fs.readFileSync(require.resolve('../public/js/I18n.js'), 'utf8');
        for (const [locales, saved, expected] of [
            [['ja-JP'], null, 'ja'],
            [['fr-CA'], null, 'fr-CA'],
            [['zz'], null, 'en'],
            [['ja-JP'], 'en', 'en'],
            [['ja-JP'], 'fr-CA', 'fr-CA'],
        ]) {
            const dom = new JSDOM('<body><div id="preMeetingLanguage"></div></body>', {
                url: 'https://kaigi.invalid/login',
                runScripts: 'outside-only',
            });
            const window = dom.window;
            Object.defineProperty(window.navigator, 'languages', { value: locales });
            window.BRAND = { app: { language: 'en', languages: ['en', 'en-CA', 'ja', 'fr-CA'] } };
            if (saved) window.localStorage.setItem('uiLanguageOverride', saved);
            window.fetch = async () => ({ ok: true, json: async () => ({ labels: {} }) });
            window.eval(source);
            window.document.dispatchEvent(new window.Event('brand:ready'));
            await window.i18n.ready;
            assert.equal(window.i18n.getLang(), expected);
            const picker = window.document.getElementById('i18nLanguageSelect');
            picker.value = 'en';
            picker.dispatchEvent(new window.Event('change'));
            assert.equal(window.localStorage.getItem('uiLanguageOverride'), 'en');
            window.close();
        }
    });

    it('uses the same locale and saved choice on direct security/help visits without external navigation', () => {
        const source = fs.readFileSync(require.resolve('../public/js/Help.js'), 'utf8');
        for (const route of ['/security', '/help']) {
            for (const [stored, locale, expected] of [
                [null, 'ja-JP', 'ja'],
                ['fr-CA', 'ja-JP', 'fr-CA'],
                ['en', 'ja-JP', null],
                [null, 'zz', null],
            ]) {
                let destination;
                vm.runInNewContext(source, {
                    URL,
                    navigator: { languages: [locale] },
                    localStorage: { getItem: () => stored },
                    document: {
                        getElementById: () => null,
                        documentElement: {
                            dataset: {
                                publicPath: route,
                                helpLanguage: 'en',
                                helpLanguages: '["en","ja","fr-CA"]',
                            },
                        },
                    },
                    window: {
                        location: {
                            href: `https://kaigi.invalid${route}`,
                            replace: (value) => {
                                destination = value;
                            },
                        },
                    },
                });
                assert.equal(destination, expected ? `https://kaigi.invalid${route}?lang=${expected}` : undefined);
            }
        }
    });
});
