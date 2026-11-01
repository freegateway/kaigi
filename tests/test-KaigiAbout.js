'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const HtmlInjector = require('../app/src/HtmlInjector');
const { renderAbout } = require('../app/src/AboutContent');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dictionary = (language) => JSON.parse(read(`public/lang/${language}.json`)).about;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function render(page, brand = {}, context = {}) {
    const injector = Object.create(HtmlInjector.prototype);
    injector.config = brand;
    injector.cache = { page: read(`public/views/${page}.html`) };
    let output;
    injector.injectHtml(
        'page',
        {
            send: (html) => {
                output = html;
            },
        },
        context
    );
    assert.ok(output);
    return output;
}

function translator(language) {
    const strings = dictionary(language);
    return { ready: Promise.resolve(), getLang: () => language, tKey: (key, fallback) => strings[key] || fallback };
}

describe('Kaigi project information', () => {
    it('centres only the meeting popup logo without changing standalone About alignment', () => {
        const css = read('public/css/Room.css');
        const rule = css.match(/\.swal2-popup \.swal2-image\.img-about\s*\{[^}]+\}/)?.[0];
        assert.ok(rule);
        const dom = new JSDOM(
            `<style>${rule}</style><div class="swal2-popup"><img id="popupLogo" class="swal2-image img-about"></div><main class="about-local"><img id="pageLogo" class="about-local-logo"></main>`
        );
        const popup = dom.window.getComputedStyle(dom.window.document.getElementById('popupLogo'));
        assert.equal(popup.marginLeft, 'auto');
        assert.equal(popup.marginRight, 'auto');
        assert.equal(popup.justifySelf, 'center');
        const page = dom.window.getComputedStyle(dom.window.document.getElementById('pageLogo'));
        assert.notEqual(page.marginLeft, 'auto');
        assert.notEqual(page.justifySelf, 'center');
        assert.equal(read('public/views/about.html').includes('img-about'), false);
        dom.window.close();
    });
    it('shares Kaigi-first core content and the package version between the page and popup', () => {
        const about = require('../app/src/config.template').ui.brand.about;
        const page = new JSDOM(render('about', { site: { sourceCodeUrl: '/source/exact.tar.xz' } }));
        const popup = new JSDOM(about.html);
        for (const key of [
            'projectTitle',
            'intro',
            'projectPurpose',
            'licenseAndModifications',
            'mediasoupNotice',
            'licenseNotice',
        ]) {
            assert.equal(
                page.window.document.querySelector(`[data-about-key="${key}"]`).textContent,
                popup.window.document.querySelector(`[data-about-key="${key}"]`).textContent
            );
        }
        for (const dom of [page, popup]) {
            const document = dom.window.document;
            assert.equal(document.querySelector('[data-kaigi-version]').textContent, version);
            const headings = Array.from(
                document.querySelectorAll('.kaigi-about-content h2'),
                (node) => node.textContent.trim()
            );
            assert.deepEqual(headings, ['About Kaigi', 'Credits & Open Source Software']);
            assert.equal(document.querySelector('[href*="linkedin.com"]'), null);
            assert.equal(document.querySelector('[href*="docs.mirotalk.com"]'), null);
            assert.equal(document.querySelector('[data-umami-event]'), null);
            dom.window.close();
        }
    });

    it('renders version and source without JavaScript, including when branding injection is disabled', () => {
        for (const htmlInjection of [true, false]) {
            const dom = new JSDOM(render('about', { htmlInjection, site: { sourceCodeUrl: '/source/exact.tar.xz' } }));
            assert.equal(dom.window.document.querySelector('[data-kaigi-version]').textContent, version);
            assert.equal(
                dom.window.document.getElementById('sourceCodeUrl').getAttribute('href'),
                '/source/exact.tar.xz'
            );
            dom.window.close();
        }
    });

    it('keeps hostile source values literal and meeting data out of template expansion', () => {
        const dom = new JSDOM(render('about', { site: { sourceCodeUrl: '/source/$&?q="<img src=x>"' } }));
        assert.equal(dom.window.document.querySelector('.kaigi-about-content img'), null);
        assert.equal(
            dom.window.document.getElementById('sourceCodeUrl').getAttribute('href'),
            '/source/$&?q="<img src=x>"'
        );
        assert.equal(
            new JSDOM(renderAbout('javascript:alert(1)')).window.document
                .getElementById('sourceCodeUrl')
                .getAttribute('href'),
            'https://github.com/freegateway/kaigi'
        );
        const meeting = '{{KAIGI_ABOUT}} {{APP_NAME}} $& </script>';
        const room = new JSDOM(render('Room', {}, { meeting }));
        assert.deepEqual(JSON.parse(room.window.document.getElementById('authorizedMeeting').textContent), { meeting });
        dom.window.close();
        room.window.close();
    });

    it('has complete server-rendered popup content even without /brand customization', () => {
        const dom = new JSDOM(render('Room', { htmlInjection: false }), { runScripts: 'outside-only' });
        const { window } = dom;
        const source = read('public/js/Room.js');
        const start = source.indexOf('function showAbout() {'),
            end = source.indexOf('// BREAKOUT ROOMS', start);
        let popup;
        Object.assign(window, {
            BRAND: { about: { html: '', title: 'About Kaigi' } },
            sound() {},
            swalBackground: '#fff',
            Swal: {
                fire: (options) => {
                    popup = options;
                },
            },
            renderRoomTemplate: (_template, values) => values.html.aboutContent,
        });
        window.eval(source.slice(start, end));
        window.showAbout();
        assert.match(popup.html, /Miroslav Pejic/);
        const rendered = new JSDOM(popup.html);
        assert.equal(rendered.window.document.querySelector('[data-kaigi-version]').textContent, version);
        assert.ok(rendered.window.document.querySelector('a[href="https://mediasoup.org/"]'));
        rendered.window.close();
        window.close();
    });
    it('localizes the About page without replacing the operator identity or installation source link', async () => {
        for (const language of ['en-CA', 'fr-CA', 'ja']) {
            const dom = new JSDOM(render('about'), {
                runScripts: 'outside-only',
                url: 'https://conference.example/about',
            });
            const { window } = dom;
            try {
                await tick();
                window.i18n = translator(language);
                window.fetch = async (url) => {
                    assert.equal(url, '/brand');
                    return {
                        json: async () => ({
                            message: {
                                site: {
                                    name: 'Operator conference',
                                    description: 'Operator description',
                                    copyright: 'Operator artwork copyright',
                                    contactEmail: 'operator@example.org',
                                    sourceCodeUrl: '/source/exact-installation.tar.xz',
                                },
                            },
                        }),
                    };
                };
                for (const script of window.document.querySelectorAll('script:not([src])'))
                    window.eval(script.textContent);
                window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
                await tick();
                await tick();
                assert.equal(window.document.getElementById('siteName').textContent, 'Operator conference');
                assert.equal(window.document.getElementById('siteCopyright').textContent, 'Operator artwork copyright');
                assert.equal(
                    window.document.getElementById('sourceCodeUrl').getAttribute('href'),
                    '/source/exact-installation.tar.xz'
                );
                assert.equal(
                    window.document.getElementById('kaigiProjectTitle').textContent,
                    dictionary(language).projectTitle
                );
                assert.equal(window.document.documentElement.lang, language);
                assert.equal(window.document.querySelector('[data-kaigi-version]').textContent, version);
                assert.ok(window.document.querySelector('a[href="https://github.com/miroslavpejic85/mirotalksfu"]'));
                assert.match(window.document.body.textContent, /Miroslav Pejic/);
                assert.doesNotMatch(window.document.body.textContent, /HARDENED/);
            } finally {
                window.close();
            }
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
            window.Swal = {
                fire: (options) => {
                    popup = options;
                },
            };
            window.renderRoomTemplate = (template, values) => values.html.aboutContent;
            window.i18n = translator('ja');
            window.i18n.tKey = (key, fallback) =>
                key === 'projectPurpose'
                    ? '<img src="https://untrusted.example/tracker">'
                    : dictionary('ja')[key] || fallback;
            window.eval(source.slice(start, end));
            window.showAbout();
            assert.equal(popup.title, dictionary('ja').projectTitle);
            assert.equal(popup.imageUrl, undefined);
            const content = new JSDOM(popup.html).window.document;
            assert.equal(
                content.querySelector('[data-about-key="projectPurpose"]').textContent,
                '<img src="https://untrusted.example/tracker">'
            );
            assert.equal(content.querySelector('img'), null);
            assert.match(content.body.textContent, /Miroslav Pejic/);
            assert.ok(content.querySelector('a[href^="mailto:"]'));
            assert.equal(content.querySelector('[data-kaigi-version]').textContent, version);
            const sourceLink = content.querySelector('[data-about-key="correspondingSource"]');
            assert.equal(
                sourceLink.getAttribute('href'),
                new JSDOM(about.html).window.document
                    .querySelector('[data-about-key="correspondingSource"]')
                    .getAttribute('href')
            );
            assert.equal(content.querySelector('a[href="/about"]').target, '_blank');
            window.BRAND.about.imageUrl = '/site-assets/operator-logo.svg';
            window.showAbout();
            assert.equal(popup.imageUrl, '/site-assets/operator-logo.svg');
        } finally {
            window.close();
        }
    });
});
