'use strict';
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('public/js/RoomClient.js');
const selection = '/meeting?selection=12345678-1234-1234-1234-123456789abc';
const plain = (value) => JSON.parse(JSON.stringify(value));
function harness() {
    const timers = new Map(),
        records = [],
        navigation = [],
        removed = [],
        store = new Map();
    let nextTimer = 0;
    const storage = {
        mirotalk_auth_session_started_at: '1000',
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k),
    };
    const context = vm.createContext({
        URLSearchParams,
        console: { log() {}, warn() {}, info() {}, error() {} },
        setTimeout: (cb) => {
            let id = ++nextTimer;
            timers.set(id, cb);
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        window: {
            location: { pathname: '/meeting', search: selection.slice(8) },
            sessionStorage: storage,
            localStorage: {},
        },
        localStorage: { removeItem: (k) => removed.push(k) },
        endRoomSession() {},
        runRoomExit: (cb) => cb(),
        openURL: (url) => navigation.push(url),
        isExiting: false,
    });
    // Retain actual class-field handlers, replacing only device/DOM initialization.
    const replaced = source.replace(/    constructor\([\s\S]*?\n    }\n/, '    constructor() {}\n');
    assert.notEqual(replaced, source);
    vm.runInContext(replaced + ';globalThis.Client=RoomClient;', context);
    const client = new context.Client();
    Object.assign(client, {
        _isConnected: true,
        serverRestarting: false,
        reloadPending: false,
        signalingDisconnected: false,
        reconnectAuthenticationFailed: false,
        reconnectMediaState: null,
        peer_info: {
            peer_audio: false,
            peer_video: true,
            peer_screen: true,
            peer_token: 'secret',
            peer_presenter: true,
        },
        socket: {
            connected: true,
            connect: () => records.push('connect'),
            io: {
                reconnectionAttempts: (n) => records.push(['attempts', n]),
                reconnection: (b) => records.push(['retry', b]),
            },
        },
        renderReconnectBanner: (o) => records.push(o),
        closeReconnectAlert() {},
        showReconnectAlert() {},
        isRecording: () => false,
        hasActiveRecorder: () => false,
        exit() {},
    });
    return {
        client,
        context,
        timers,
        records,
        navigation,
        removed,
        store,
        storage,
        flush: () => {
            let calls = [...timers.values()];
            timers.clear();
            calls.forEach((cb) => cb());
        },
    };
}
describe('authenticated reconnect lifecycle', () => {
    it('waits for namespace authentication rather than Manager reconnect and schedules once', () => {
        const h = harness();
        h.client.handleDisconnect('transport close');
        h.client.handleSocketReconnect();
        assert.equal(h.timers.size, 0);
        h.client.handleSocketConnect();
        h.client.handleSocketConnect();
        assert.equal(h.timers.size, 1);
        h.flush();
        h.flush();
        assert.deepEqual(h.navigation, [selection]);
    });
    it('never reloads on the initial connection', () => {
        const h = harness();
        h.client.handleSocketConnect();
        assert.equal(h.timers.size, 0);
    });
    it('cancels pending reloads and retries on authentication rejection', () => {
        const h = harness();
        h.client.handleDisconnect('transport close');
        h.client.handleSocketConnect();
        h.client.handleSocketConnectionError(new Error('Authentication required'));
        h.client.handleSocketConnect();
        h.flush();
        h.client.refreshBrowser();
        h.flush();
        assert.deepEqual(h.navigation, []);
        assert.equal(h.client.reconnectMediaState, null);
        assert.deepEqual(h.records.at(-1), ['retry', false]);
    });
    it('rechecks logout after waiting for recording saves', () => {
        const h = harness();
        let leave;
        h.context.runRoomExit = (cb) => {
            leave = cb;
        };
        h.client.refreshBrowser();
        h.flush();
        h.context.authSessionLogoutStarted = true;
        leave();
        assert.deepEqual(h.navigation, []);
        assert.equal(h.store.size, 0);
    });
    it('cancels an interrupted reload and accepts the next authenticated connection', () => {
        const h = harness();
        h.client.handleDisconnect('transport close');
        h.client.handleSocketConnect();
        h.client.socket.connected = false;
        h.client.handleDisconnect('transport close');
        h.flush();
        assert.deepEqual(h.navigation, []);
        h.client.socket.connected = true;
        h.client.handleSocketConnect();
        h.flush();
        h.flush();
        assert.deepEqual(h.navigation, [selection]);
    });
    it('manually retries only a planned server disconnect, with an idempotent notice', () => {
        const h = harness();
        h.client.handleDisconnect('io server disconnect');
        assert.equal(h.records.includes('connect'), false);
        h.client.handleServerShutdown();
        h.client.handleServerShutdown();
        h.client.handleDisconnect('io server disconnect');
        assert.equal(h.records.filter((x) => x === 'connect').length, 1);
        assert.equal(h.records.filter((x) => Array.isArray(x) && x[0] === 'attempts').length, 1);
        assert.equal(h.records.find((x) => x.title)?.message, 'Waiting for the server. You may need to sign in again.');
    });
    it('constructs only opaque authorized-selection URLs or the login chooser', () => {
        const h = harness();
        assert.equal(h.client.getReconnectDirectJoinURL(), selection);
        for (const search of [
            '?selection=x',
            '?selection=12345678-1234-1234-1234-123456789abc&token=secret',
            '?room=private',
        ]) {
            h.context.window.location.search = search;
            assert.equal(h.client.getReconnectDirectJoinURL(), '/login?select=1');
        }
        h.client.socket.connected = false;
        h.context.window.location.search = selection.slice(8);
        assert.equal(h.client.getReconnectDirectJoinURL(), '/login?select=1');
    });
    it('stores only short-lived per-tab media flags, preserving the snapshot before teardown', () => {
        const h = harness();
        h.client.handleDisconnect('transport close');
        h.client.peer_info.peer_audio = true;
        h.client.peer_info.peer_video = false;
        h.client.refreshBrowser();
        h.flush();
        const raw = h.store.get('kaigi_reconnect_media');
        assert.doesNotMatch(raw, /secret|presenter|peer_token|peer_screen/);
        assert.deepEqual(plain(h.context.Client.consumeReconnectMediaState()), { audio: false, video: true });
        assert.equal(h.context.Client.consumeReconnectMediaState(), null);
        assert.deepEqual(h.removed, ['sfu_peer_info']);
    });
    it('discards stale, cross-session, cross-selection, malformed and unavailable storage', () => {
        const h = harness(),
            valid = {
                audio: false,
                video: false,
                sessionStartedAt: '1000',
                navigation: selection,
                expires: Date.now() + 60000,
            };
        for (const changed of [
            { expires: 0 },
            { sessionStartedAt: 'other' },
            { navigation: '/meeting?selection=other' },
            { audio: 'true' },
        ]) {
            h.store.set('kaigi_reconnect_media', JSON.stringify({ ...valid, ...changed }));
            assert.equal(h.context.Client.consumeReconnectMediaState(), null);
            assert.equal(h.store.size, 0);
        }
        h.store.set('kaigi_reconnect_media', '{');
        assert.equal(h.context.Client.consumeReconnectMediaState(), null);
        h.storage.getItem = () => {
            throw Error('Unavailable');
        };
        assert.equal(h.context.Client.consumeReconnectMediaState(), null);
    });
    it('suppresses recovery during restart/reload and cancels delayed recovery on shutdown', async () => {
        for (const flag of ['serverRestarting', 'reloadPending']) {
            const h = harness();
            h.client[flag] = true;
            let n = 0;
            h.client.recoverProducerTransport = async () => n++;
            await h.client.handleTransportLost('producer');
            assert.equal(n, 0);
        }
        const h = harness();
        let n = 0;
        h.client.recoverProducerTransport = async () => n++;
        const task = h.client.handleTransportLost('producer');
        h.client.handleServerShutdown();
        h.flush();
        await task;
        assert.equal(n, 0);
        assert.equal(h.client.recoveringProducer, false);
    });
    it('localizes the restart notice and renders translations as text in the existing accessible banner', () => {
        for (const locale of ['en', 'en-CA', 'fr-CA', 'ja']) {
            const t = JSON.parse(read('public/lang/' + locale + '.json')).dialogs;
            assert.ok(t['Server restarting']);
            assert.ok(t['Waiting for the server. You may need to sign in again.']);
        }
        const h = harness(),
            dom = new JSDOM(read('public/views/Room.html'));
        h.client.getId = (id) => dom.window.document.getElementById(id);
        delete h.client.renderReconnectBanner;
        h.context.window.i18n = { t: () => '<img src=https://external.invalid/x>' };
        h.client.showServerRestartAlert();
        assert.equal(dom.window.document.querySelector('#disconnectBannerMessage img'), null);
        assert.match(dom.window.document.querySelector('#disconnectBannerMessage').textContent, /<img/);
        assert.equal(dom.window.document.querySelector('#disconnectBanner').getAttribute('aria-hidden'), 'false');
        dom.window.close();
    });

    it('does not announce a late recovery completion after shutdown', async () => {
        const h = harness();
        let finish,
            notices = 0;
        h.client.userLog = () => {
            notices++;
        };
        h.client.recoverProducerTransport = () =>
            new Promise((resolve) => {
                finish = resolve;
            });
        const task = h.client.handleTransportLost('producer');
        h.flush();
        await Promise.resolve();
        assert.equal(typeof finish, 'function');
        h.client.handleServerShutdown();
        finish();
        await task;
        assert.equal(notices, 1); // Only the pre-shutdown recovery warning.
        assert.equal(h.client.recoveringProducer, false);
    });

    for (const kind of ['Producer', 'Consumer']) {
        it(`closes a late ${kind.toLowerCase()} transport without restoring media after shutdown`, async () => {
            const h = harness();
            let closed = false;
            const transport = {
                id: 'new',
                close: () => {
                    closed = true;
                },
            };
            Object.assign(h.client, {
                producerLabel: new Map(),
                producerRecoverySnapshot: [],
                consumers: new Map(),
                chatDataConsumers: new Map(),
                closeDeadTransport() {},
                reconcileConsumers: () => assert.fail('Must not reconcile after shutdown'),
                produce: () => assert.fail('Must not produce after shutdown'),
            });
            h.client['init' + kind + 'Transport'] = async () => {
                h.client.serverRestarting = true;
                return transport;
            };
            await assert.rejects(
                h.context.Client.prototype['recover' + kind + 'Transport'].call(h.client),
                /Media recovery cancelled/
            );
            assert.equal(closed, true);
        });
    }
});

describe('reconnect pre-meeting preferences', () => {
    const room = read('public/js/Room.js');
    it('preserves muted/off choices without enabling unavailable devices or screen capture', () => {
        const start = room.indexOf('    const reconnectMedia = RoomClient.consumeReconnectMediaState();');
        const end = room.indexOf('    if (navigator.getDisplayMedia', start);
        assert(start > 0 && end > start);
        for (const available of [false, true]) {
            const context = vm.createContext({
                RoomClient: { consumeReconnectMediaState: () => ({ audio: false, video: false }) },
                isAudioAllowed: available,
                isVideoAllowed: available,
                isScreenAllowed: true,
                joinRoomWithScreen: true,
                handleAudio() {
                    context.isAudioAllowed = false;
                },
                handleVideo() {
                    context.isVideoAllowed = false;
                },
                restoreVirtualBackgroundState() {},
            });
            vm.runInContext(room.slice(start, end), context);
            assert.equal(context.isAudioAllowed, false);
            assert.equal(context.isVideoAllowed, false);
            assert.equal(context.isScreenAllowed, false);
            assert.equal(context.joinRoomWithScreen, false);
        }
    });

    it('restores supported local backgrounds but rejects external sources and malformed settings', () => {
        const start = room.indexOf('function restoreVirtualBackgroundState()');
        const end = room.indexOf('async function loadVirtualBackgroundSettings()', start);
        assert(start > 0 && end > start);
        let saved;
        const context = vm.createContext({
            URL,
            virtualBackgroundBlurLevel: null,
            virtualBackgroundSelectedImage: null,
            virtualBackgroundTransparent: null,
            window: { location: { href: 'https://meet.example/meeting', origin: 'https://meet.example' } },
            localStorage: { getItem: () => saved },
            isVirtualBackgroundAvailable: () => true,
        });
        vm.runInContext(read('public/js/VirtualBackground.js') + '\n' + room.slice(start, end), context);
        saved = JSON.stringify({ blurLevel: 20, imageUrl: 'https://external.invalid/image.jpg' });
        vm.runInContext('restoreVirtualBackgroundState()', context);
        assert.equal(context.virtualBackgroundBlurLevel, 20);
        assert.equal(context.virtualBackgroundSelectedImage, null);
        saved = JSON.stringify({ imageUrl: '/images/virtual-background/default/background-1.jpg' });
        vm.runInContext('restoreVirtualBackgroundState()', context);
        assert.match(context.virtualBackgroundSelectedImage, /^\/images\//);
        saved = JSON.stringify({ imageUrl: 'https://external.invalid/image.jpg' });
        vm.runInContext('restoreVirtualBackgroundState()', context);
        assert.equal(context.virtualBackgroundSelectedImage, null);
        saved = '{';
        vm.runInContext('restoreVirtualBackgroundState()', context);
        assert.equal(context.virtualBackgroundBlurLevel, null);
    });
});
