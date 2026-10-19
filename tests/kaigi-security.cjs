'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../app/src/Server.js'), 'utf8');
test('Kaigi configuration is isolated from a colocated MiroTalk configuration', () => {
    const os = require('node:os'), { spawnSync } = require('node:child_process');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-config-isolation-'));
    const environment = { ...process.env, KAIGI_CONFIG_DIR: directory, SFU_ANNOUNCED_IP: '127.0.0.1' };
    delete environment.SERVER_LISTEN_PORT;
    const config = path.join(__dirname, '../app/src/config.js');
    const readPort = () => {
        const result = spawnSync(process.execPath, ['-e',
            'console.log(JSON.stringify(require(process.argv[1]).server.listen.port))', config],
            { env: environment, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return Number(JSON.parse(result.stdout.trim()));
    };
    try {
        fs.writeFileSync(path.join(directory, 'mirotalk.conf'), 'WEB_LISTEN_PORT=7444\n');
        fs.writeFileSync(path.join(directory, 'kaigi.conf'), 'WEB_LISTEN_PORT=7443\n');
        assert.equal(readPort(), 7443);
        fs.unlinkSync(path.join(directory, 'kaigi.conf'));
        assert.equal(readPort(), 3010);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
function sessions() {
    const sockets = new Map(), rooms = new Map();
    const hostCfg = { protected: false, users: [{ username: 'alice', allowed_rooms: ['approved'] }] };
    const context = vm.createContext({
        io: { sockets: { sockets } }, roomList: rooms, hostCfg,
        authSessionCfg: { idleTimeoutMs: 1000, maxAgeMs: 10000 }, randomUUID,
        log: { info() {}, warn() {} },
        decodeToken: token => token,
        isRoomAllowedForUser: async () => false,
    });
    vm.runInContext(source.slice(source.indexOf('const authSessions = new Map();'), source.indexOf('function authSessionClientState(')) +
        source.slice(source.indexOf('    function authenticatedSession('), source.indexOf('    async function isAuthPeer(')) +
        ';globalThis.api={authSessions,authSessionIsExpired,revokeAuthSession,requireAuthSession,authenticatedSession,sessionAllowsRoom};', context);
    return { ...context.api, sockets, rooms, hostCfg };
}
function session(overrides = {}) {
    return { id: 's1', ip: '192.0.2.1', username: 'alice', source: 'local', rooms: ['approved'], createdAt: 0, lastActivity: 0, maxAgeMs: 10000, ...overrides };
}
test('idle sessions expire but quiet admitted conference participants stay authorized', () => {
    const h = sessions(), s = session();
    assert.equal(h.authSessionIsExpired(s, 2000), true);
    h.sockets.set('socket', { id: 'socket', authSessionId: s.id, room_id: 'meeting', authenticatedMeeting: true });
    h.rooms.set('meeting', { getPeer: id => id === 'socket' ? {} : null });
    assert.equal(h.authSessionIsExpired(s, 2000), false);
    assert.equal(s.lastActivity, 2000);
});
test('absolute expiry still applies inside an active conference', () => {
    const h = sessions(), s = session();
    h.sockets.set('socket', { id: 'socket', authSessionId: s.id, room_id: 'meeting', authenticatedMeeting: true });
    h.rooms.set('meeting', { getPeer: () => ({}) });
    assert.equal(h.authSessionIsExpired(s, 10000), true);
});
test('unadmitted sockets cannot suspend idle expiry', () => {
    const h = sessions(), s = session();
    h.sockets.set('socket', { id: 'socket', authSessionId: s.id, room_id: 'meeting', authenticatedMeeting: true });
    h.rooms.set('meeting', { getPeer: () => null });
    assert.equal(h.authSessionIsExpired(s, 2000), true);
});
test('logout revokes only that browser session, preserving another session on the same IP', () => {
    const h = sessions(), first = session(), other = session({ id: 's2' });
    const disconnected = [];
    h.authSessions.set(first.id, first); h.authSessions.set(other.id, other);
    for (const s of [first, other]) h.sockets.set(s.id, { authSessionId: s.id, disconnect: () => disconnected.push(s.id) });
    assert.equal(h.revokeAuthSession('s1'), true);
    assert.deepEqual(disconnected, ['s1']);
    assert.equal(h.authSessions.has('s2'), true);
});
test('revoked tokens cannot recover a session', () => {
    const h = sessions();
    assert.throws(() => h.requireAuthSession('revoked'), /expired/);
});
test('token identity must match its live session', () => {
    const h = sessions(), now = Date.now();
    h.authSessions.set('s1', session({ createdAt: now, lastActivity: now }));
    assert.throws(() => h.authenticatedSession({ sessionId: 's1', username: 'mallory' }), /identity mismatch/);
    assert.equal(h.authenticatedSession({ sessionId: 's1', username: 'alice' }).id, 's1');
});
test('removing a local account invalidates its live token', () => {
    const h = sessions(), now = Date.now();
    h.authSessions.set('s1', session({ createdAt: now, lastActivity: now }));
    h.hostCfg.users = [];
    assert.throws(() => h.authenticatedSession({ sessionId: 's1', username: 'alice' }), /account removed/);
});
test('local meeting grants use exact keys and reflect current account grants', async () => {
    const h = sessions(), s = session();
    assert.equal(await h.sessionAllowsRoom(s, 'approved'), true);
    assert.equal(await h.sessionAllowsRoom(s, 'approved-extra'), false);
    h.hostCfg.users[0].allowed_rooms = ['new-key'];
    assert.equal(await h.sessionAllowsRoom(s, 'approved'), false);
    assert.equal(await h.sessionAllowsRoom(s, 'new-key'), true);
});
test('LDAP grants never turn a literal asterisk into unrestricted authorization', async () => {
    const h = sessions(), s = session({ source: 'ldap', rooms: ['会議', '*'] });
    assert.equal(await h.sessionAllowsRoom(s, '会議'), true);
    assert.equal(await h.sessionAllowsRoom(s, 'unassigned'), false);
});
test('local explicitly configured wildcard retains its canonical behavior', async () => {
    const h = sessions(); h.hostCfg.users[0].allowed_rooms = ['*'];
    assert.equal(await h.sessionAllowsRoom(session(), 'another-meeting'), true);
});
test('no peer identity can acquire presenter authority', () => {
    const code = source.slice(source.indexOf('    function isPeerPresenter('), source.indexOf('    async function authenticateIdentity('));
    const context = vm.createContext({}); vm.runInContext(code, context);
    assert.equal(context.isPeerPresenter('meeting', 'socket', 'admin', 'uuid'), false);
});
test('meeting properties reject duplicate grants and unknown restrictions', () => {
    const { parseProperties } = require('../app/src/MeetingSettings');
    assert.throws(() => parseProperties('{"m":{},"m":{}}'), /duplicate/);
    assert.throws(() => parseProperties('{"m":{"restrictions":["unknown"]}}'), /supported codes/);
    assert.deepEqual(parseProperties('{"会議":{"restrictions":["RP"]}}').restrictions['会議'], ['RP']);
});

test('saved noise preferences survive new defaults and navigation query strings', () => {
    const room = fs.readFileSync(path.join(__dirname, '../public/js/Room.js'), 'utf8');
    const code = room.slice(room.indexOf('function applyNoiseSuppressionDefault()'), room.indexOf('function getHideMeActive()'));
    for (const [saved, configured, expected] of [
        [{mic_noise_suppression:true},false,true],
        [{mic_noise_suppression:false},true,false],
        [null,false,false],
        [null,true,true],
    ]) {
        const state = {mic_noise_suppression: saved?.mic_noise_suppression ?? true};
        const context=vm.createContext({lS:{getLocalStorageSettings:()=>saved},localStorageSettings:state,BUTTONS:{settings:{customNoiseSuppressionDefault:configured}},getQueryParam:()=>{throw new Error('navigation must not override preferences');}});
        vm.runInContext(code+';applyNoiseSuppressionDefault();',context);
        assert.equal(state.mic_noise_suppression,expected);
    }
});
