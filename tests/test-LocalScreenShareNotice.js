'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/RoomClient.js'), 'utf8');
const translations = fs.readFileSync(path.join(root, 'public/js/I18n.js'), 'utf8');
const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(root, 'public/lang', lang + '.json'), 'utf8'));
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('local screen-share notice', () => {
    let dom, client, videoTrack, audioTrack, stream, stops, closed;

    beforeEach(() => {
        dom = new JSDOM('<div id="tabLanguages"></div><div id="videoMediaContainer"><div id="existing-camera">Camera preview</div></div>', {
            url: 'https://meet.example/room', runScripts: 'outside-only',
        });
        dom.window.eval(source + '\nwindow.RoomClient = RoomClient;');
        dom.window.handleAspectRatio = () => {};
        dom.window.MediaStream = class {
            constructor() { this.tracks = []; }
            addTrack(track) { this.tracks.push(track); }
            getTracks() { return this.tracks; }
        };
        stops = 0;
        closed = [];
        videoTrack = { stop() { stops++; } };
        audioTrack = { stop() { throw new Error('UI must not stop screen audio'); } };
        stream = { getVideoTracks: () => [videoTrack], getAudioTracks: () => [audioTrack] };
        client = Object.create(dom.window.RoomClient.prototype);
        client.peer_id = 'local-peer';
        client.videoMediaContainer = dom.window.document.getElementById('videoMediaContainer');
        client.getId = (id) => dom.window.document.getElementById(id);
        client.closeProducer = (type) => closed.push(type);
    });

    afterEach(() => dom.window.close());

    it('renders no captured pixels or preview controls and leaves the source tracks intact', async () => {
        const video = await client.handleProducer('screen', 'screenType', stream);
        assert.equal(video.hidden, true);
        assert.equal(video.autoplay, false);
        assert.equal(video.controls, false);
        assert.equal(video.getAttribute('aria-hidden'), 'true');
        assert.equal(video.srcObject.getTracks()[0], videoTrack);
        assert.equal(stream.getAudioTracks()[0], audioTrack);
        assert.equal(stops, 0);
        const tile = client.getId('screen__video');
        assert.equal(tile.querySelector('[role="status"]').textContent, 'You are sharing your screen');
        assert.equal(tile.querySelectorAll('button').length, 1);
        assert.equal(client.getId('screen__vb').querySelector('button').textContent, 'Stop sharing');
        assert(client.getId('existing-camera'));
        assert.equal(client.getId('screen__pin'), null);
        assert.equal(client.getId('screen__pictureInPicture'), null);
        assert.equal(client.getId('screen__fullScreen'), null);
        tile.querySelector('button').click();
        assert.deepEqual(closed, ['screenType']);
        assert.equal(stops, 0, 'the UI delegates stopping to closeProducer');
        const css = fs.readFileSync(path.join(root, 'public/css/Room.css'), 'utf8');
        assert(/\.Camera\.local-screen-share-notice > video\s*\{\s*display: none !important;/.test(css));
    });

    it('uses ordinary producer cleanup and can recreate the notice after recovery/restart', async () => {
        for (let n = 0; n < 3; n++) {
            const video = await client.handleProducer('screen-' + n, 'screenType', stream);
            assert.equal(dom.window.document.querySelectorAll('.local-screen-share-notice').length, 1);
            client.removeVideoProducer(video, 'fixture-stop');
            assert.equal(dom.window.document.querySelectorAll('.local-screen-share-notice').length, 0);
            assert.equal(client.getId('screen-' + n + '__vb'), null);
            assert(client.getId('existing-camera'));
        }
        assert.equal(stops, 3);
    });

    it('localizes the notice and Stop sharing during live language switches', async () => {
        dom.window.BRAND = { app: { language: 'en-CA', translationMode: 'native' } };
        dom.window.fetch = async (url) => ({ ok: true, json: async () => readLocale(path.basename(url, '.json')) });
        dom.window.tippy = () => [];
        dom.window.Swal = { fire() {} };
        dom.window.eval(translations);
        dom.window.document.dispatchEvent(new dom.window.Event('brand:ready'));
        await dom.window.i18n.ready;
        await client.handleProducer('localized-screen', 'screenType', stream);
        await tick();
        for (const lang of ['en-CA', 'ja', 'fr-CA', 'en']) {
            const select = client.getId('i18nLanguageSelect');
            select.value = lang;
            select.dispatchEvent(new dom.window.Event('change'));
            await tick();
            await tick();
            const locale = readLocale(lang);
            assert.equal(dom.window.document.querySelector('[role="status"]').textContent, locale.labels['You are sharing your screen']);
            assert.equal(client.getId('localized-screen__vb').querySelector('button').textContent, locale.buttons['Stop sharing']);
        }
        client.getId('localized-screen__vb').querySelector('button').click();
        assert.deepEqual(closed, ['screenType']);
    });
});
