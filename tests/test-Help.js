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

describe('public help guide and inert illustrations', () => {
    it('quotes resolved control labels in headings and instructions in every guide language', () => {
        for (const language of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const configured = {
                ...brand,
                app: { ...brand.app, joinButtonLabel: 'Enter <approved> meeting' },
                login: { buttonLabel: 'Login [[SCREEN_ON]] <literal>' },
            };
            const dom = new JSDOM(help.renderHelp(configured, language));
            const document = dom.window.document;
            const login = document.getElementById('loginButton').textContent.trim();
            assert(document.getElementById('help-login-title').textContent.includes(login));
            assert(document.querySelector('.help-instructions ol').textContent.includes(login));
            assert(
                document
                    .querySelectorAll('.help-instructions ol')[1]
                    .textContent.includes(document.getElementById('joinSelectRoomButton').textContent.trim())
            );
            assert.equal(document.querySelector('.help-instructions img'), null);
            dom.window.close();
        }
    });

    it('matches landing language control markup, classes and flag/native-name labels', () => {
        const source = read('public/js/I18n.js');
        const start = source.indexOf('const LANG_DISPLAY = '),
            end = source.indexOf('\n    };', start) + 7;
        const display = vm.runInNewContext(source.slice(start, end) + '; LANG_DISPLAY');
        const landing = new JSDOM(read('public/views/login.html')).window.document;
        const document = new JSDOM(help.renderHelp(brand, 'ja')).window.document;
        assert.equal(
            document.querySelector('#preMeetingLanguage label').htmlFor,
            landing.querySelector('#preMeetingLanguage label').htmlFor
        );
        assert(document.querySelector('#preMeetingLanguage label .fa-globe'));
        assert.equal(document.querySelector('select').className, 'form-select text-light bg-dark notranslate');
        for (const option of document.querySelectorAll('option'))
            assert.equal(option.textContent, `${display[option.value].flag} ${display[option.value].name}`);
        assert.equal(document.querySelector('select').value, 'ja');
    });

    it('restricts guide locales to supported configured choices and explains an unsupported-only list', () => {
        const input = { app: { language: 'ja', languages: ['fr-CA', 'ja', 'fr-CA', 'de'] } };
        const document = new JSDOM(help.renderHelp(input, 'en')).window.document;
        assert.deepEqual(
            [...document.querySelectorAll('option')].map((option) => option.value),
            ['fr-CA', 'ja']
        );
        assert.equal(document.documentElement.lang, 'ja');
        const fallback = new JSDOM(help.renderHelp({ app: { languages: ['de'] } }, 'ja')).window.document;
        assert.equal(fallback.documentElement.lang, 'en');
        assert.match(fallback.body.textContent, /none of these languages is enabled/);
    });

    it('provides matching section targets, keyboard-friendly navigation and complete localized topics', () => {
        const translations = require('../app/src/templates/HelpTopics.json');
        for (const language of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const document = new JSDOM(help.renderHelp(brand, language)).window.document;
            const links = [...document.querySelectorAll('.help-sidebar a')];
            assert.equal(links.length, 8);
            assert.equal(new Set(links.map((link) => link.hash)).size, 8);
            for (const link of links) assert(document.getElementById(link.hash.slice(1)));
            assert(document.querySelector('.help-sidebar details summary'));
            assert.equal(document.querySelectorAll('.help-text-topic').length, 6);
            const ids = translations[language === 'en-CA' ? 'en' : language].sections.map((section) => section.id);
            assert.deepEqual(
                ids,
                translations.en.sections.map((section) => section.id)
            );
            assert(!document.body.textContent.includes('[[PREJOIN_LABEL]]'));
        }
    });

    it('permits only the integrity-pinned navigation script and only same-origin language navigation', () => {
        const crypto = require('node:crypto');
        const source = read('public/js/Help.js');
        const document = new JSDOM(help.renderHelp(brand, 'ja')).window.document;
        const hash = crypto.createHash('sha256').update(source).digest('base64');
        assert.equal(document.querySelector('script').getAttribute('integrity'), `sha256-${hash}`);
        let listener, destination;
        const picker = {
            value: 'fr-CA',
            options: [{ value: 'ja' }, { value: 'fr-CA' }],
            addEventListener: (event, handler) => {
                assert.equal(event, 'change');
                listener = handler;
            },
        };
        vm.runInNewContext(source, {
            URL,
            document: { getElementById: () => picker },
            window: {
                location: {
                    origin: 'https://meeting.example',
                    hash: '#help-screen',
                    assign: (value) => {
                        destination = value;
                    },
                },
            },
        });
        listener();
        assert.equal(destination, 'https://meeting.example/help?lang=fr-CA#help-screen');
        destination = null;
        picker.value = 'https://outside.example';
        listener();
        assert.equal(destination, null);
        assert.doesNotMatch(
            source,
            /fetch\(|XMLHttpRequest|WebSocket|socket\.io|getUserMedia|getDisplayMedia|localStorage|sessionStorage/
        );
    });

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
        assert.equal(document.querySelector('input, iframe, video, audio'), null);
        assert.equal(document.querySelectorAll('script').length, 1);
        assert.equal(document.querySelector('script').getAttribute('src'), '/js/Help.js');
        assert.equal(document.querySelectorAll('form').length, 1);
        assert.equal(document.querySelector('form').getAttribute('action'), '/help');
        assert.equal(document.querySelectorAll('select').length, 1);
        assert.equal(
            document.querySelector('[inert] script, [inert] form, [inert] input, [inert] select, [inert] button'),
            null
        );
        for (const element of document.querySelectorAll('*')) {
            for (const attribute of element.attributes) assert.equal(/^on/i.test(attribute.name), false);
        }
        assert.equal(document.querySelectorAll('[inert]').length, 6);
        assert.equal(document.querySelectorAll('[role="img"][aria-label]').length, 6);
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
        assert.equal(dom.window.document.querySelector('script:not([src="/js/Help.js"]), [onerror]'), null);
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
            assert.match(response.headers['content-security-policy'], /script-src 'sha256-[A-Za-z0-9+/=]+'/);
            assert.match(response.headers['content-security-policy'], /script-src-attr 'none'/);
            assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
            assert.match(response.headers['content-security-policy'], /form-action 'self'/);
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
