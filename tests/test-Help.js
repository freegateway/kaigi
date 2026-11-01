'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const express = require('express');
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const help = require('../app/src/Help');
const { version } = require('../package.json');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const brand = {
    app: { language: 'en-CA', name: 'Operator conference' },
    site: {
        name: 'Operator site',
        logo: '/site-assets/operator-logo.svg',
        description: 'Operator description',
        copyright: 'Operator artwork copyright',
        newRoomTitle: 'Authorized meetings',
        newRoomDescription: 'Choose an approved meeting.',
    },
    login: { heading: 'Operator sign-in', description: 'Use your assigned account.', buttonLabel: 'Continue' },
    siteTranslations: {
        en: { SITE_DESCRIPTION: 'English operator text' },
        ja: { SITE_NAME: '運営者の会議サイト', LOGIN_HEADING: 'サインイン', NEW_ROOM_TITLE: '許可された会議' },
        'fr-CA': { SITE_NAME: 'Réunions de l’organisme' },
    },
    password: 'secret-password',
    users: ['private-account'],
    meetingTranslations: { 'private-meeting': {} },
    about: { html: 'private-unrelated-brand-data' },
};

describe('public inert help prototype', () => {
    it('renders the configured identity and localized text without projecting unrelated data', () => {
        for (const language of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const html = help.renderHelp(brand, language);
            const dom = new JSDOM(html),
                document = dom.window.document;
            assert.equal(document.documentElement.lang, language);
            assert.equal(document.querySelector('#loginButton').textContent.trim(), 'Continue');
            assert.equal(
                document.querySelector('.help-header img').getAttribute('src'),
                '/site-assets/operator-logo.svg'
            );
            assert.match(
                document.querySelector('.help-footer').textContent,
                new RegExp(version.replaceAll('.', '\\.'))
            );
            assert.match(document.querySelector('.help-footer').textContent, /Operator artwork copyright/);
            assert.doesNotMatch(html, /secret-password|private-account|private-meeting|private-unrelated-brand-data/);
            assert.doesNotMatch(html, /{{[A-Z_]+}}/);
            if (language === 'ja') {
                assert.equal(document.querySelector('#loginHeading').textContent.trim(), 'サインイン');
                assert.equal(document.querySelector('#loginNewRoomTitle').textContent.trim(), '許可された会議');
            }
            dom.window.close();
        }
    });

    it('matches the application branding overlay order for visible configuration fields', () => {
        const source = read('public/js/Brand.js');
        const start = source.indexOf('function localizedSiteBrand('),
            end = source.indexOf('let baseSiteBrand', start);
        const context = vm.createContext({});
        vm.runInContext(source.slice(start, end), context);
        const localized = context.localizedSiteBrand(brand, 'ja');
        const dom = new JSDOM(help.renderHelp(brand, 'ja'));
        assert.equal(dom.window.document.querySelector('.help-identity span').textContent, localized.site.name);
        assert.equal(dom.window.document.querySelector('#loginHeading').textContent.trim(), localized.login.heading);
        assert.equal(
            dom.window.document.querySelector('#loginNewRoomTitle').textContent.trim(),
            localized.site.newRoomTitle
        );
        dom.window.close();
    });

    it('contains no executable application or real credential/meeting controls', () => {
        const dom = new JSDOM(help.renderHelp(brand, 'ja'), { url: 'https://meeting.example/help' });
        const document = dom.window.document;
        assert.equal(document.querySelector('script, form, input, select, button, iframe, video, audio'), null);
        for (const element of document.querySelectorAll('*')) {
            for (const attribute of element.attributes) assert.equal(/^on/i.test(attribute.name), false);
        }
        assert.equal(document.querySelectorAll('[inert]').length, 2);
        assert.equal(document.querySelectorAll('[role="img"][aria-label]').length, 2);
        assert.equal(document.querySelector('[inert] a'), null);
        assert.equal(document.getElementById('username').textContent, 'example.user');
        assert.equal(document.getElementById('selectRoom').textContent, 'サンプル会議');
        for (const element of document.querySelectorAll('[src], link[href]')) {
            assert.equal(
                new URL(element.getAttribute('src') || element.getAttribute('href'), dom.window.location.href).origin,
                dom.window.location.origin
            );
        }
        dom.window.close();
    });

    it('escapes branding as text and refuses remote or active logo sources', () => {
        const hostile = {
            site: {
                name: '<img src=x onerror=alert(1)>',
                description: '</p><script>alert(1)</script>',
                logo: 'https://external.invalid/pixel',
            },
            login: { heading: '<script>secret</script>' },
        };
        const dom = new JSDOM(help.renderHelp(hostile));
        assert.match(dom.window.document.querySelector('.help-identity').textContent, /<img/);
        assert.equal(dom.window.document.querySelector('script, [onerror]'), null);
        for (const image of dom.window.document.images) assert.equal(image.getAttribute('src'), '/images/logo.svg');
        for (const logo of [
            'javascript:alert(1)',
            '//external.invalid/pixel',
            '/auth/session/logout',
            'data:image/svg+xml,evil',
        ]) {
            const page = new JSDOM(help.renderHelp({ site: { logo } }));
            assert.equal(page.window.document.querySelector('img').getAttribute('src'), '/images/logo.svg');
            page.window.close();
        }
        dom.window.close();
    });

    it('supports disabled branding and deterministic unsupported-language fallback', () => {
        const dom = new JSDOM(help.renderHelp({ ...brand, htmlInjection: false }, 'ja'));
        assert.equal(dom.window.document.querySelector('.help-identity span').textContent, 'Kaigi');
        assert.doesNotMatch(dom.serialize(), /Operator|secret-password/);
        const fallback = new JSDOM(help.renderHelp({ app: { language: 'ja' } }, ['en', 'ja']));
        assert.equal(fallback.window.document.documentElement.lang, 'ja');
        dom.window.close();
        fallback.window.close();
    });

    it('uses real shared login CSS while keeping the chooser visible and footer in normal flow', async () => {
        const requests = [];
        const localStyles = requestInterceptor((request) => {
            const pathname = new URL(request.url).pathname;
            requests.push(pathname);
            if (pathname === '/site-assets/site.css')
                return new Response('', { headers: { 'Content-Type': 'text/css' } });
            assert(pathname.startsWith('/css/') || pathname.startsWith('/vendor/'));
            return new Response(fs.readFileSync(path.join(root, 'public', pathname)), {
                headers: { 'Content-Type': 'text/css' },
            });
        });
        const dom = new JSDOM(help.renderHelp(brand), {
            url: 'https://meeting.example/help',
            resources: { interceptors: [localStyles] },
            virtualConsole: new VirtualConsole(),
        });
        await new Promise((resolve) => dom.window.addEventListener('load', resolve));
        const document = dom.window.document;
        assert(
            requests.includes('/css/login.css') &&
                requests.includes('/css/landing.css') &&
                requests.includes('/site-assets/site.css')
        );
        assert.equal(dom.window.getComputedStyle(document.querySelector('#joinRoomForm')).display, 'block');
        assert.equal(dom.window.getComputedStyle(document.querySelector('.help-footer')).position, 'static');
        for (const id of ['loginHeading', 'loginButton', 'loginNewRoomTitle', 'joinSelectRoomButton', 'logoutButton']) {
            assert(read('public/views/login.html').includes(`id="${id}"`));
            assert(document.getElementById(id));
        }
        const css = read('public/css/help.css');
        assert.match(css, /max-width: 900px/);
        assert.match(css, /max-width: 480px/);
        assert.match(css, /@media print/);
        dom.window.close();
    });

    it('serves help publicly with strict independent CSP and no query/header data disclosure', async () => {
        const app = express();
        app.use(require('../app/src/middleware/ResourcePolicy')('https://meeting.example'));
        const source = read('app/src/Server.js');
        const first = source.indexOf("    app.get('/help',"),
            last = source.indexOf('    // local site and open-source information', first);
        assert(first > 0 && last > first);
        vm.runInNewContext(source.slice(first, last), {
            app,
            require: (name) => {
                assert.equal(name, './Help');
                return help;
            },
            config: { ui: { brand } },
        });
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        function request(route) {
            return new Promise((resolve, reject) => {
                http.get(
                    {
                        host: '127.0.0.1',
                        port: server.address().port,
                        path: route,
                        headers: { Cookie: 'private-session-cookie', Authorization: 'Bearer private-token' },
                    },
                    (response) => {
                        let body = '';
                        response.on('data', (chunk) => (body += chunk));
                        response.on('end', () =>
                            resolve({ status: response.statusCode, headers: response.headers, body })
                        );
                    }
                ).on('error', reject);
            });
        }
        try {
            const response = await request('/help?lang=ja&meeting=private-query-meeting');
            assert.equal(response.status, 200);
            assert.match(response.headers['content-security-policy'], /script-src 'none'/);
            assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
            assert.match(response.headers['content-security-policy'], /form-action 'none'/);
            assert.match(response.headers['content-security-policy'], /, /); // Separate intersecting policies, not duplicate directives.
            assert.match(response.headers['permissions-policy'], /camera=\(\), microphone=\(\), display-capture=\(\)/);
            assert.equal(response.headers['cache-control'], 'no-store');
            assert.doesNotMatch(
                response.body,
                /private-session-cookie|private-token|private-query-meeting|secret-password/
            );
            assert.match(response.body, /lang="ja"/);
            const alias = await request('/manual');
            assert.equal(alias.status, 302);
            assert.equal(alias.headers.location, '/help');
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
