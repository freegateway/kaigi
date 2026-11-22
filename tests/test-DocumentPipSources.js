'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');

describe('Document PiP source filtering and cleanup', () => {
    it('includes only visible nonprivate streams and releases observers on refresh/close', async () => {
        const main = new JSDOM('<div id="tiles"></div>'), pip = new JSDOM('');
        const document = main.window.document, observers = [];
        class Observer {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe() { this.active = true; }
            disconnect() { this.active = false; }
        }
        const context = vm.createContext({ window: main.window, document, console: { log() {} },
            showDocumentPipBtn: true, MutationObserver: Observer,
            documentPictureInPicture: { requestWindow: async () => pip.window },
            getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
            userLog: () => assert.fail('unexpected PiP error'),
        });
        vm.runInContext(source + ';globalThis.proto = RoomClient.prototype;', context);
        const client = Object.assign(Object.create(context.proto), {
            videoMediaContainer: document.getElementById('tiles'), videoProducerId: 'camera',
            getId: () => assert.fail('PiP must use the iterated element directly'),
        });
        context.rc = client;
        for (const id of ['camera', 'private', 'settingsVideoPreviewVideo', 'hidden', 'source', '', '__videoShare']) {
            const video = document.createElement('video'); video.id = id; video.srcObject = { id };
            if (id === 'private') video.className = 'videoCircle';
            if (id === 'camera') video.className = 'mirror';
            if (id === 'hidden') video.hidden = true;
            if (id === 'source') video.setAttribute('aria-hidden', 'true');
            client.videoMediaContainer.appendChild(video);
        }
        try {
            await client.documentPictureInPictureOpen();
            const videos = pip.window.document.querySelectorAll('video');
            assert.equal(videos.length, 1);
            assert.equal(videos[0].srcObject.id, 'camera');
            assert(videos[0].classList.contains('mirror'));
            assert.equal(observers.filter(observer => observer.active).length, 3);
            observers[0].callback([]);
            assert.equal(observers.filter(observer => observer.active).length, 3);
            pip.window.dispatchEvent(new pip.window.Event('unload'));
            assert.equal(observers.filter(observer => observer.active).length, 0);
        } finally { main.window.close(); pip.window.close(); }
    });
});
