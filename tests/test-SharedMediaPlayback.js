'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('same-origin shared audio/video playback', () => {
    let dom;
    function fixture() {
        dom = new JSDOM('<button id="close"></button><div id="tiles"></div>', { url: 'https://meet.example/' });
        const { window } = dom, { document } = window;
        let calls = 0, paused = 0, loaded = 0;
        const notices = [];
        window.HTMLMediaElement.prototype.play = function () { calls++; return Promise.resolve(); };
        window.HTMLMediaElement.prototype.pause = () => paused++;
        window.HTMLMediaElement.prototype.load = () => loaded++;
        const context = vm.createContext({ window, document, URL, console: { log() {} },
            videoCloseBtn: document.getElementById('close'), show() {}, hide() {},
            html: { pin: 'pin' }, BUTTONS: { videoShare: { fullScreenButton: true, pinVideoButton: true } },
            handleAspectRatio() {},
        });
        vm.runInContext(source + ';globalThis.proto = RoomClient.prototype;', context);
        const client = Object.assign(Object.create(context.proto), {
            isMobileSafari: true, isMobileDevice: false, _moderator: {},
            videoMediaContainer: document.getElementById('tiles'),
            getId: id => document.getElementById(id),
            createButton(id) { const button = document.createElement('button'); button.id = id; return button; },
            handlePN() {}, refreshPinLabels() {}, setTippy() {}, sound() {},
            userLog: (...args) => notices.push(args),
        });
        return { window, document, client, notices, calls: () => calls, paused: () => paused, loaded: () => loaded };
    }
    afterEach(() => dom?.window.close());

    it('detects MIME types from URL paths while preserving same-origin restrictions', () => {
        const { client } = fixture();
        assert.equal(client.getVideoType('/audio/FILE.MP3?download=1#start'), 'audio/mpeg');
        assert.equal(client.getVideoType('/video.webm?x=1'), 'video/webm');
        assert.equal(client.isVideoTypeSupported('/clip.MP4?x=1'), true);
        for (const url of ['https://elsewhere.example/a.mp4', '//elsewhere.example/a.mp3', 'javascript:x.mp4', '/watch?youtube.com', '/unknown'])
            assert.equal(client.isVideoTypeSupported(url), false, url);
    });
    it('renders MP3 as audio, preserves Safari URLs and suppresses audio fullscreen', async () => {
        const f = fixture(), url = '/audio/test.MP3?download=1';
        f.client.openVideo({ video_url: url, is_youtube: false });
        const audio = f.document.getElementById('__videoShare');
        assert.equal(audio.tagName, 'AUDIO');
        assert.equal(audio.type, 'audio/mpeg');
        assert.equal(audio.getAttribute('src'), url);
        assert.equal(f.document.getElementById('__videoFS'), null);
        assert(f.document.querySelector('.shared-media-poster'));
        await tick();
        assert.equal(f.calls(), 1);
        f.client.closeVideo();
        assert.equal(f.paused(), 1);
        assert.equal(f.loaded(), 1);
        assert.equal(audio.getAttribute('src'), null);
    });
    it('keeps video inline and rejects foreign or unsupported received media without replacing playback', () => {
        const f = fixture();
        f.client.openVideo({ video_url: '/clip.mp4?x=1', is_youtube: false });
        const video = f.document.getElementById('__videoShare');
        assert.equal(video.tagName, 'VIDEO');
        assert.equal(video.playsInline, true);
        assert.equal(video.getAttribute('src'), '/clip.mp4?x=1');
        assert(f.document.getElementById('__videoFS'));
        for (const url of ['https://elsewhere.example/a.mp4', '/bad', 'javascript:a.mp4'])
            f.client.openVideo({ video_url: url });
        f.client.openVideo({ video_url: '/clip.mp4', is_youtube: true });
        assert.equal(f.document.getElementById('__videoShare'), video);
    });
    for (const language of ['en-CA', 'ja', 'fr-CA']) {
        it(`offers a localized native retry button after blocked autoplay (${language})`, async () => {
            const f = fixture(), catalogue = require(`../public/lang/${language}.json`);
            f.window.i18n = { t: (key, section) => catalogue[section]?.[key] || key };
            f.window.HTMLMediaElement.prototype.play = () => Promise.reject(Object.assign(Error('private-url'), { name: 'NotAllowedError' }));
            f.client.openVideo({ video_url: '/audio.mp3' });
            await tick();
            const button = f.document.querySelector('.shared-media-play');
            assert.equal(button.tagName, 'BUTTON');
            assert.equal(button.textContent, catalogue.buttons['Play shared media']);
            let clicked = 0;
            f.document.getElementById('__videoShare').play = () => { clicked++; return Promise.resolve(); };
            button.click();
            assert.equal(clicked, 1, 'play must be invoked directly in the gesture handler');
            await tick();
            assert.equal(button.isConnected, false);
            assert.equal(f.notices.length, 0);
        });
    }
    it('ignores late autoplay failures after closing or replacing shared media', async () => {
        const f = fixture();
        let fail;
        f.window.HTMLMediaElement.prototype.play = () => new Promise((_resolve, reject) => { fail = reject; });
        f.client.openVideo({ video_url: '/old.mp3' });
        const rejectOld = fail;
        f.client.openVideo({ video_url: '/new.mp4' });
        rejectOld(Object.assign(Error(), { name: 'NotAllowedError' }));
        await tick();
        assert.equal(f.document.querySelector('.shared-media-play'), null);
        f.client.closeVideo();
        fail(Object.assign(Error(), { name: 'NotAllowedError' }));
        await tick();
        assert.equal(f.document.querySelector('.shared-media-play'), null);
    });
    it('reports unsupported playback generically without unhandled rejection or exception details', async () => {
        const f = fixture();
        f.window.HTMLMediaElement.prototype.play = () => { throw Error('private-url'); };
        f.client.openVideo({ video_url: '/clip.mp4' });
        await tick();
        assert.equal(f.notices.length, 1);
        assert(!JSON.stringify(f.notices).includes('private-url'));
    });
});
