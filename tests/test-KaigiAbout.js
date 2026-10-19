'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dictionary = (language) => JSON.parse(read(`public/lang/${language}.json`)).about;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function translator(language) {
    const strings = dictionary(language);
    return { ready: Promise.resolve(), getLang: () => language, tKey: (key, fallback) => strings[key] || fallback };
}

describe('Kaigi project information', () => {
    it('localizes the About page without replacing the operator identity or installation source link', async () => {
        for (const language of ['en-CA', 'fr-CA', 'ja']) {
            const dom = new JSDOM(read('public/views/about.html'), { runScripts: 'outside-only', url: 'https://conference.example/about' });
            const { window } = dom;
            try {
                await tick();
                window.i18n = translator(language);
                window.fetch = async (url) => {
                    assert.equal(url, '/brand');
                    return { json: async () => ({ message: { site: {
                        name: 'Operator conference', description: 'Operator description',
                        copyright: 'Operator artwork copyright', contactEmail: 'operator@example.org',
                        sourceCodeUrl: '/source/exact-installation.tar.xz',
                    } } }) };
                };
                for (const script of window.document.querySelectorAll('script:not([src])')) window.eval(script.textContent);
                window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
                await tick();
                await tick();
                assert.equal(window.document.getElementById('siteName').textContent, 'Operator conference');
                assert.equal(window.document.getElementById('siteCopyright').textContent, 'Operator artwork copyright');
                assert.equal(window.document.getElementById('sourceCodeUrl').getAttribute('href'), '/source/exact-installation.tar.xz');
                assert.equal(window.document.getElementById('kaigiProjectTitle').textContent, dictionary(language).projectTitle);
                assert.equal(window.document.documentElement.lang, language);
                assert.ok(window.document.querySelector('a[href="https://github.com/miroslavpejic85/mirotalksfu"]'));
                assert.match(window.document.body.textContent, /Miroslav Pejic/);
                assert.doesNotMatch(window.document.body.textContent, /HARDENED/);
            } finally { window.close(); }
        }
    });

    it('localizes meeting credits as text and keeps upstream credits, configured source and optional artwork', () => {
        const source = read('public/js/Room.js');
        const start = source.indexOf('function showAbout() {');
        const end = source.indexOf('// BREAKOUT ROOMS', start);
        const about = require('../app/src/config.template').ui.brand.about;
        const dom = new JSDOM('', { runScripts: 'outside-only' });
        const { window } = dom;
        try {
            let popup;
            window.sound = () => {};
            window.swalBackground = '#fff';
            window.BRAND = { about: { ...about, imageUrl: '' } };
            window.Swal = { fire: (options) => { popup = options; } };
            window.renderRoomTemplate = (template, values) => values.html.aboutContent;
            window.i18n = translator('ja');
            window.i18n.tKey = (key, fallback) => key === 'projectPurpose' ? '<img src="https://untrusted.example/tracker">' : dictionary('ja')[key] || fallback;
            window.eval(source.slice(start, end));
            window.showAbout();
            assert.equal(popup.title, dictionary('ja').projectTitle);
            assert.equal(popup.imageUrl, undefined);
            const content = new JSDOM(popup.html).window.document;
            assert.equal(content.querySelector('[data-about-key="projectPurpose"]').textContent, '<img src="https://untrusted.example/tracker">');
            assert.equal(content.querySelector('img'), null);
            assert.match(content.body.textContent, /Miroslav Pejic/);
            assert.ok(content.querySelector('a[href^="mailto:"]'));
            const sourceLink = content.querySelector('[data-about-key="correspondingSource"]');
            assert.equal(sourceLink.getAttribute('href'), new JSDOM(about.html).window.document.querySelector('[data-about-key="correspondingSource"]').getAttribute('href'));
            assert.equal(content.querySelector('a[href="/about"]').target, '_blank');
            window.BRAND.about.imageUrl = '/site-assets/operator-logo.svg';
            window.showAbout();
            assert.equal(popup.imageUrl, '/site-assets/operator-logo.svg');
        } finally { window.close(); }
    });
});
