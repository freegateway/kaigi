'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const HtmlInjector = require('../app/src/HtmlInjector');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('login translation sources and live switching', () => {
    let dom;
    async function load(lang) {
        const injector = Object.create(HtmlInjector.prototype);
        injector.config = require('../app/src/config').ui.brand;
        injector.cache = { login: read('public/views/login.html') };
        let html;
        injector.injectHtml('login', {
            req: { headers: { 'accept-language': lang } },
            send(value) { html = value; },
        });
        dom = new JSDOM(html, {
            url: 'https://kaigi.invalid/',
            runScripts: 'outside-only',
            virtualConsole: new VirtualConsole(),
        });
        const w = dom.window;
        Object.defineProperty(w.navigator, 'languages', { value: [lang] });
        w.BRAND = { app: { languages: ['en', 'en-CA', 'ja', 'fr-CA'] } };
        w.fetch = async (url) => ({
            ok: true,
            json: async () => JSON.parse(read('public/lang/' + path.basename(url))),
        });
        w.eval(read('public/js/I18n.js'));
        w.eval(
            read('public/js/Login.js') + '\nObject.assign(window, { showLoginError, configureRoomSelector, login });'
        );
        w.document.dispatchEvent(new w.Event('brand:ready'));
        await w.i18n.ready;
        return w;
    }
    async function choose(w, lang) {
        const picker = w.document.getElementById('i18nLanguageSelect');
        picker.value = lang;
        picker.dispatchEvent(new w.Event('change'));
        await tick();
        await tick();
    }
    afterEach(() => dom?.window.close());

    for (const language of ['en-CA', 'ja', 'fr-CA']) {
        it(`submits the rendered ${language} login page and opens the authorized meeting selector`, async () => {
            const w = await load(language);
            const document = w.document;
            const button = document.getElementById('loginButton');
            const loader = document.getElementById('loginBtnLoader');
            assert.ok(loader, 'localization must preserve the adjacent loading indicator');
            assert.equal(button.querySelectorAll(':scope > span').length, 2);
            document.getElementById('username').value = 'employee';
            document.getElementById('password').value = 'fixture-password';
            const requests = [];
            let complete;
            w.axios = { post: (url, data) => {
                requests.push({ url, ...data });
                return new Promise(resolve => { complete = resolve; });
            } };
            // Advance the existing transition without waiting for animation timers.
            w.setTimeout = callback => { callback(); return 0; };
            w.requestAnimationFrame = callback => { callback(); return 0; };
            button.click();
            assert.deepEqual(requests, [{ url: '/auth/session/login', username: 'employee', password: 'fixture-password' }]);
            assert.equal(button.disabled, true);
            assert.equal(loader.classList.contains('show'), true);
            assert.equal(document.getElementById('loginBtnText').style.display, 'none');
            complete({ data: { message: 'fixture-session', allowedRooms: ['Customer Inc', 'all-employees'], displayname: 'Employee' } });
            await tick();
            assert.equal(document.getElementById('loginForm').style.display, 'none');
            assert.equal(document.getElementById('joinRoomForm').classList.contains('show'), true);
            assert.deepEqual(Array.from(document.getElementById('selectRoom').options, option => option.value), ['Customer Inc', 'all-employees']);
            assert.equal(w.sessionStorage.peer_token, 'fixture-session');
        });
    }

    it('keeps password visibility, title, aria-label and pressed state synchronized across language switches', async () => {
        const w = await load('ja');
        const button = w.document.getElementById('togglePassword');
        button.click();
        assert.equal(w.document.getElementById('password').type, 'text');
        assert.equal(button.title, 'パスワードを隠す');
        assert.equal(button.getAttribute('aria-pressed'), 'true');
        await choose(w, 'fr-CA');
        assert.equal(button.title, 'Masquer le mot de passe');
        assert.equal(button.getAttribute('aria-label'), button.title);
        button.click();
        assert.equal(w.document.getElementById('password').type, 'password');
        assert.equal(button.title, JSON.parse(read('public/lang/fr-CA.json')).buttons['Show password']);
        await choose(w, 'en');
        assert.equal(button.title, 'Show password');
    });
    it('translates existing login errors and countdown text on a live language switch without injecting HTML', async () => {
        const w = await load('ja');
        w.showLoginError('Invalid credentials. Please try again.');
        const message = w.document.getElementById('loginErrorText');
        assert.equal(message.textContent, '認証情報が無効です。もう一度お試しください。');
        await choose(w, 'fr-CA');
        assert.equal(message.textContent, 'Identifiants invalides. Veuillez réessayer.');
        w.showLoginError('Too many login attempts. Please try again after 15 minutes.');
        assert.equal(message.textContent, 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.');
        await choose(w, 'ja');
        assert.equal(message.textContent, 'ログイン試行回数が多すぎます。15 分後にもう一度お試しください。');
        await choose(w, 'en-CA');
        assert.equal(message.textContent, 'Too many login attempts. Please try again after 15 minutes.');
        w.showLoginError('<img src=x onerror=alert(1)>');
        assert.equal(message.querySelector('img'), null);
        assert.equal(message.textContent, '<img src=x onerror=alert(1)>');
    });
    it('localizes an authorized custom meeting placeholder while leaving meeting identities and site labels unchanged', async () => {
        const w = await load('ja');
        w.sessionStorage.mirotalk_allow_any_meeting = 'true';
        w.document.getElementById('loginBtnText').textContent = 'Site custom login label';
        w.configureRoomSelector(['*'], 'Test');
        const input = w.document.getElementById('customRoomInput');
        assert.equal(input.placeholder, '会議名を入力');
        input.value = 'Exact Meeting *';
        await choose(w, 'fr-CA');
        assert.equal(input.placeholder, 'Entrez le nom de la réunion');
        assert.equal(input.value, 'Exact Meeting *');
        assert.equal(w.document.getElementById('loginBtnText').textContent, 'Site custom login label');
        await choose(w, 'en');
        assert.equal(input.placeholder, 'Enter meeting name');
    });
    it('renders actual failed login responses in the selected language without logging credential-bearing errors', async () => {
        const w = await load('fr-CA');
        const messages = [];
        w.console.warn = (message) => messages.push(message);
        w.console.error = (message) => messages.push(message);
        w.document.getElementById('username').value = 'test-user';
        w.document.getElementById('password').value = 'fixture-password';
        w.axios = {
            post: async () => {
                throw {
                    response: {
                        status: 429,
                        data: { message: 'Too many login attempts. Please try again after 1 minute.' },
                    },
                    config: { password: 'fixture-password' },
                };
            },
        };
        w.login();
        await tick();
        await tick();
        assert.equal(
            w.document.getElementById('loginErrorText').textContent,
            'Trop de tentatives de connexion. Veuillez réessayer dans 1 minute.'
        );
        assert.deepEqual(messages, ['Login request failed']);
        assert.equal(w.document.getElementById('loginButton').disabled, false);
        assert.equal(w.document.getElementById('loginBtnLoader').classList.contains('show'), false);
        assert.equal(w.document.getElementById('loginBtnText').style.display, 'inline');
    });
});
