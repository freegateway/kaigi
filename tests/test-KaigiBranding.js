'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const HtmlInjector = require('../app/src/HtmlInjector');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Kaigi operator and attendee branding', () => {
    it('preserves operator branding on supported pages with local credits/privacy footers', () => {
        for (const page of ['login', 'landing', 'newroom', 'permission', '404', 'privacy']) {
            const dom = new JSDOM(read(`public/views/${page}.html`), {
                runScripts: 'outside-only', url: 'https://meet.example/login',
            });
            const { window } = dom;
            try {
                const brandSource = read('public/js/Brand.js').replace(/\ninitialize\(\);\s*$/, '');
                window.eval(brandSource + `\nsetBrand({site: {
                    title: 'Operator meetings', name: 'Operator', logo: '/site-assets/operator.svg',
                    copyright: 'Operator artwork', privacyPolicyUrl: '/site-assets/privacy.html'
                }}); customizeSite();`);
                assert.equal(window.document.title, 'Operator meetings', page);
                assert.equal(window.document.getElementById('siteCopyright').textContent, 'Operator artwork', page);
                const footer = window.document.querySelector('footer');
                assert.equal(footer.querySelector('a[href="/about"]').textContent, 'About, Credits & Open Source', page);
                assert.doesNotMatch(footer.textContent, /MiroTalk|HARDENED|STANDARD/, page);
                const privacy = window.document.getElementById('privacyPolicyLink');
                assert.equal(privacy.getAttribute('href'), '/site-assets/privacy.html', page);
                assert.equal(privacy.hidden, false, page);
                for (const logo of window.document.querySelectorAll('[data-brand-logo]')) {
                    assert.equal(logo.getAttribute('src'), '/site-assets/operator.svg', page);
                }
                assert.equal(window.document.querySelector('main footer'), null, page);
            } finally { window.close(); }
        }
    });

    it('localizes deployment privacy information using text-only stable identifiers', async () => {
        for (const language of ['en-CA', 'fr-CA', 'ja']) {
            const strings = JSON.parse(read(`public/lang/${language}.json`)).about;
            const dom = new JSDOM(read('public/views/privacy.html'), { runScripts: 'outside-only' });
            const { window } = dom;
            try {
                await tick();
                window.i18n = {
                    ready: Promise.resolve(), getLang: () => language,
                    tKey: (key, fallback) => key === 'privacyResourcesTitle'
                        ? '<img src="https://untrusted.example/">' : strings[key] || fallback,
                };
                for (const script of window.document.querySelectorAll('script:not([src])')) window.eval(script.textContent);
                window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
                await tick();
                assert.equal(window.document.title, strings.privacyTitle);
                assert.equal(window.document.documentElement.lang, language);
                assert.equal(window.document.querySelector('[data-about-key="privacyOperator"]').textContent, strings.privacyOperator);
                assert.equal(window.document.querySelector('[data-about-key="privacyResourcesTitle"]').textContent, '<img src="https://untrusted.example/">');
                assert.equal(window.document.querySelector('img[src^="https://untrusted"]'), null);
                assert.doesNotMatch(window.document.querySelector('main').textContent, /Umami|MiroTalk|never uploaded|only error-level/);
                for (const key of ['privacyTitle', 'privacyOperator', 'privacyAccessTitle', 'privacyAccess', 'privacyMediaTitle', 'privacyMedia', 'privacyResourcesTitle', 'privacyResources']) {
                    assert.ok(strings[key], `${language}: ${key}`);
                    if (language !== 'en-CA') {
                        assert.notEqual(strings[key], JSON.parse(read('public/lang/en.json')).about[key], `${language}: ${key}`);
                    }
                }
            } finally { window.close(); }
        }
    });

    it('uses Kaigi fallbacks while retaining administrator-controlled names', () => {
        assert.equal(HtmlInjector.prototype.getInjectData.call({ config: {} }).APP_NAME, 'Kaigi');
        assert.equal(HtmlInjector.prototype.getInjectData.call({ config: { app: { name: 'Operator' } } }).APP_NAME, 'Operator');
        let html;
        HtmlInjector.prototype.injectHtml.call({ cache: { page: '<title>{{APP_NAME}}</title>' }, config: { htmlInjection: false } }, 'page', { send: (value) => { html = value; } });
        assert.equal(html, '<title>Kaigi</title>');
        const client = read('public/js/RoomClient.js');
        assert.match(client, /avatar: '\.\.\/images\/logo\.svg'/);
        assert.ok(fs.existsSync(path.join(__dirname, '../public/images/logo.svg')));
    });
});
