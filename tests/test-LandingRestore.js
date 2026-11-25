'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = file => fs.readFileSync(file, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('landing-page history restoration', () => {
    let dom, w, requests, completeLogin, signal, intervals;
    async function load(session = {}) {
        dom = new JSDOM(read('public/views/login.html'), { url: 'https://kaigi.invalid/',
            runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
        w = dom.window; requests = []; intervals = 0;
        // Wait for the fixture's initial load; exercise the production handlers explicitly.
        await tick();
        for (const [key, value] of Object.entries(session)) w.sessionStorage.setItem(key, value);
        w.setInterval = () => { intervals++; return intervals; };
        w.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
        w.axios = { post(url, body, options) {
            requests.push({ url, body }); signal = options.signal;
            return new Promise(resolve => { completeLogin = resolve; });
        } };
        w.ScrollReveal = () => ({ reveal() { return this; } });
        w.anime = () => ({}); w.anime.random = () => 0; w.anime.timeline = () => ({ add() { return this; } });
        w.eval(read('public/js/Login.js'));
        w.eval(read('public/js/Landing.js'));
        return w.document;
    }
    const session = (token = 'session-one', rooms = ['One', 'Two']) => ({
        peer_token: token, mirotalk_allowed_rooms: JSON.stringify(rooms), mirotalk_displayname: 'Employee',
        mirotalk_meeting_translations: '{}', mirotalk_allow_any_meeting: 'false',
    });
    function restore() { w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true })); }
    function assertView(authenticated) {
        const doc = w.document, login = doc.getElementById('loginForm'), join = doc.getElementById('joinRoomForm');
        assert.equal(login.style.display === 'none', authenticated);
        assert.equal(join.classList.contains('show'), authenticated);
        assert.equal((authenticated ? join : login).style.opacity, '1');
        assert.equal(doc.getElementById('loginButton').disabled, false);
    }
    afterEach(() => dom?.window.close());

    it('shows essential controls before reveal scripts run, including desktop and short-viewport CSS', async () => {
        const doc = await load();
        const style = doc.createElement('style'); style.textContent = read('public/css/landing.css'); doc.head.append(style);
        const hidingRules = [];
        function collect(rules) { for (const rule of rules) {
            if (rule.cssRules) collect(rule.cssRules);
            else if (rule.style?.opacity === '0') hidingRules.push(rule.selectorText);
        } }
        collect(style.sheet.cssRules);
        for (const selector of hidingRules.filter(selector => selector.includes('reveal-'))) {
            assert(!doc.querySelector('.login-card').matches(selector));
            assert(!doc.querySelector('.site-header').matches(selector));
        }
        assertView(false);
    });
    it('restores visible login controls and typed values after cached-page history navigation', async () => {
        const doc = await load();
        doc.getElementById('username').value = 'employee@example.invalid';
        doc.getElementById('password').value = 'typed-password';
        doc.getElementById('loginButtonLabel').innerHTML = '<strong>ログイン</strong>';
        const decoration = doc.createElement('div'); decoration.className = 'reveal-from-bottom'; doc.body.append(decoration);
        w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: true }));
        // Model the document's cached presentation being restored without load.
        doc.body.classList.remove('is-loaded');
        doc.getElementById('loginForm').style.opacity = '0';
        Object.defineProperty(w, 'innerHeight', { value: 220, configurable: true });
        restore(); restore();
        assertView(false); assert(decoration.classList.contains('is-revealed'));
        assert(doc.body.classList.contains('is-loaded'));
        assert.equal(doc.getElementById('username').value, 'employee@example.invalid');
        assert.equal(doc.getElementById('password').value, 'typed-password');
        assert.equal(doc.getElementById('loginButtonLabel').innerHTML, '<strong>ログイン</strong>');
        assert.equal(requests.length, 0); assert.equal(intervals, 0);
    });
    it('preserves the selected authorized meeting across repeated restores without duplicate monitors or login requests', async () => {
        const doc = await load(session()); await tick(); requests.length = 0;
        doc.getElementById('selectRoom').value = 'Two';
        doc.getElementById('joinRoomForm').style.opacity = '0';
        for (let i = 0; i < 3; i++) restore();
        assertView(true); assert.equal(doc.getElementById('selectRoom').value, 'Two');
        assert.equal(intervals, 1);
        assert.equal(requests.length, 3);
        assert(requests.every(r => r.url === '/auth/session/touch' && r.options.headers.Authorization === 'Bearer session-one'));
    });
    it('preserves an unfinished custom meeting name when restoring an authorized wildcard selector', async () => {
        const doc = await load({ ...session('admin', ['*']), mirotalk_allow_any_meeting: 'true' });
        const input = doc.getElementById('customRoomInput'); input.value = 'Customer Inc';
        restore(); restore(); assertView(true);
        assert.equal(doc.getElementById('customRoomInput'), input); assert.equal(input.value, 'Customer Inc');
    });
    it('reconciles changed or cleared session grants and rejects malformed restored data', async () => {
        const doc = await load(session());
        for (const [key, value] of Object.entries(session('session-two', ['New meeting']))) w.sessionStorage.setItem(key, value);
        restore(); assertView(true);
        assert.deepEqual(Array.from(doc.getElementById('selectRoom').options, option => option.value), ['New meeting']);
        assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer session-two');
        w.sessionStorage.removeItem('peer_token'); restore(); assertView(false);
        for (const [key, value] of Object.entries(session())) w.sessionStorage.setItem(key, value);
        w.sessionStorage.mirotalk_allowed_rooms = '{malformed'; restore(); assertView(false);
        assert.equal(w.sessionStorage.getItem('peer_token'), null);
    });
    it('clears an expired server session instead of retaining the restored meeting selector', async () => {
        await load(session()); await tick();
        w.fetch = async () => ({ ok: false, status: 401 }); restore(); await tick();
        assertView(false); assert.equal(w.sessionStorage.getItem('peer_token'), null);
    });
    it('does not clear an existing selector on a temporary session-check network failure', async () => {
        const doc = await load(session()); await tick();
        doc.getElementById('selectRoom').value = 'Two';
        w.fetch = async () => { throw Error('offline'); }; restore(); await tick();
        assertView(true); assert.equal(doc.getElementById('selectRoom').value, 'Two');
        assert.equal(w.sessionStorage.peer_token, 'session-one');
    });
    it('ignores a late rejection for an old session after restoration selects a new session', async () => {
        await load(session()); await tick();
        let rejectOld;
        w.fetch = () => new Promise(resolve => { rejectOld = resolve; }); restore();
        for (const [key, value] of Object.entries(session('session-two', ['New meeting']))) w.sessionStorage.setItem(key, value);
        w.fetch = async () => ({ ok: true }); restore();
        rejectOld({ ok: false, status: 401 }); await tick();
        assertView(true); assert.equal(w.sessionStorage.peer_token, 'session-two');
    });
    it('cancels an interrupted login and ignores its late response without resubmitting credentials', async () => {
        const doc = await load(); doc.getElementById('username').value = 'employee'; doc.getElementById('password').value = 'password';
        doc.getElementById('loginButton').click(); assert.equal(requests.length, 1);
        w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: true }));
        assert.equal(signal.aborted, true); restore(); assertView(false);
        completeLogin({ data: { message: 'late-session', allowedRooms: ['One'], displayname: 'Employee' } }); await tick();
        assertView(false); assert.equal(w.sessionStorage.getItem('peer_token'), null); assert.equal(requests.length, 1);
        doc.getElementById('loginButton').click(); assert.equal(requests.length, 2);
        completeLogin({ data: { message: 'current-session', allowedRooms: ['One'], displayname: 'Employee' } }); await tick();
        assertView(true); assert.equal(w.sessionStorage.peer_token, 'current-session');
    });
    it('switches to the meeting selector immediately and ignores ordinary initial pageshow', async () => {
        const doc = await load(session()); const selector = doc.getElementById('joinRoomForm');
        assertView(true); requests.length = 0;
        w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: false }));
        assert.equal(requests.length, 0); assert.equal(selector.style.transform, '');
    });
});
