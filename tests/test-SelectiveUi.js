'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');
const read = name => fs.readFileSync(name, 'utf8');
const room = read('public/js/Room.js'), clientSource = read('public/js/RoomClient.js');
function fn(source, name) {
    const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`));
    assert(match, name); return match[0];
}
function fixture(markup) {
    const dom = new JSDOM(markup || read('public/views/Room.html'));
    const document = dom.window.document;
    const context = vm.createContext({ window: dom.window, document, console, setTimeout, clearTimeout,
        isSpeakingHighlightEnabled: true, isPitchBarEnabled: true, isBroadcastingEnabled: false, isPresenter: false,
        mediaType: { video: 'videoType', screen: 'screenType' }, show() {}, hide() {},
    });
    vm.runInContext(clientSource + ';globalThis.proto = RoomClient.prototype;', context);
    const client = Object.assign(Object.create(context.proto), {
        getId: id => document.getElementById(id), getName: () => null,
        videoMediaContainer: document.getElementById('videoMediaContainer'),
        videoPinMediaContainer: document.getElementById('videoPinMediaContainer'),
        getPeerAudioBtn: () => null, getPeerAudioVolumeBar: () => null,
    });
    context.rc = client; return { dom, document, context, client };
}
describe('selective Kaigi UI integration', () => {
    it('places one Send button in the composer and one participants control in the header, preserving input semantics', () => {
        const f = fixture();
        try {
            assert.equal(f.document.querySelectorAll('#chatSendButton').length, 1);
            assert(f.document.getElementById('chatSendButton').closest('.chat-toolbar-right'));
            assert.equal(f.document.querySelectorAll('#chatShowParticipantsListBtn').length, 1);
            assert(f.document.getElementById('chatShowParticipantsListBtn').closest('.chat-option-buttons'));
            f.context.chatMessage = f.document.getElementById('chatMessage');
            f.context.getId = f.client.getId; f.client.chatMessageLength = 100;
            vm.runInContext(fn(room, 'updateChatCharCount'), f.context);
            for (const [length, expected] of [[0, ''], [79, ''], [80, '80 / 100'], [100, '100 / 100']]) {
                f.context.chatMessage.value = 'x'.repeat(length); f.context.updateChatCharCount();
                assert.equal(f.document.getElementById('chatCharCount').textContent, expected);
                assert.equal(f.document.getElementById('chatCharCount').classList.contains('is-limit'), length >= 100);
            }
            f.client.cleanMessage();
            assert.equal(f.context.chatMessage.value, ''); assert.equal(f.document.getElementById('chatCharCount').textContent, '');
            assert(!f.document.getElementById('chatCharCount').classList.contains('is-limit'));
            f.client.isPlistOpen = () => true; f.client.syncParticipantsListButton();
            assert.equal(f.document.getElementById('chatShowParticipantsListBtn').getAttribute('aria-pressed'), 'true');
            f.client.isPlistOpen = () => false; f.client.syncParticipantsListButton();
            assert.equal(f.document.getElementById('chatShowParticipantsListBtn').getAttribute('aria-pressed'), 'false');
        } finally { f.dom.window.close(); }
    });
    it('keeps the participants split intact on phones and leaves all layout choices as labelled native selects', () => {
        const f = fixture();
        try {
            vm.runInContext(fn(room, 'restoreSplitButtonsBorderRadius'), f.context);
            f.context.restoreSplitButtonsBorderRadius();
            assert.equal(f.document.getElementById('participantsButton').style.borderRadius, '');
            assert.equal(f.document.getElementById('startAudioButton').style.borderRadius, '10px');
            for (const id of ['participantViewMode', 'pinVideoPosition']) {
                const select = f.document.getElementById(id); assert.equal(select.tagName, 'SELECT');
                assert(select.parentElement.querySelector('.select-value-icon'));
                assert(Array.from(select.options).every(option => option.textContent.trim() && option.dataset.icon));
            }
        } finally { f.dom.window.close(); }
    });
    it('excludes hidden camera tiles from the strip and preserves the hidden screen source across resize', () => {
        const f = fixture('<div id="videoMediaContainer"><div id="notice" class="Camera local-screen-share-notice"><video hidden aria-hidden="true"></video></div><div class="Camera" hidden></div><div class="Camera hidden"></div><div class="Camera" aria-hidden="true"></div><div class="Camera" style="display:none"></div><div id="camera" class="Camera"></div></div>');
        try {
            vm.runInContext(read('public/js/VideoGrid.js'), f.context);
            const cameras = f.context.getVisibleCameraElements();
            assert.deepEqual(Array.from(cameras, node => node.id), ['notice', 'camera']);
            f.client.isVideoPinned = true; f.client.videoPinPosition = 'speaker-top';
            f.context.layoutPinnedStrip(f.client.videoMediaContainer, cameras, 120, 180, 5);
            assert(!f.client.videoMediaContainer.classList.contains('pinned-strip-vertical'), 'position overrides narrow aspect ratio');
            assert.equal(f.document.querySelector('#notice video').hidden, true);
            assert.equal(f.document.querySelector('#notice video').getAttribute('aria-hidden'), 'true');
            f.client.isVideoPinned = false; f.context.layoutPinnedStrip(f.client.videoMediaContainer, cameras, 600, 300, 5);
            assert(!f.client.videoMediaContainer.classList.contains('pinned-strip'));
        } finally { f.dom.window.close(); }
    });
    it('clears both speaker indicators and timers on mute and departure, including unusual participant IDs', () => {
        const clock = sinon.useFakeTimers();
        const f = fixture('<div id="videoMediaContainer"><div class="Camera" data-peer-id="peer:one"></div></div><div id="videoPinMediaContainer"></div><ul id="participantsList"><li id="peer:one"><button id="peer:one___pAudio"><span class="participant-action-icon"><i class="fas fa-microphone"></i></span></button></li></ul>');
        try {
            f.client.handleAudioVolume({ peer_id: 'peer:one', audioVolume: 7 });
            assert.equal(f.document.querySelectorAll('.speaking').length, 3);
            f.client.setPeerAudio('peer:one', false);
            assert.equal(f.document.querySelectorAll('.speaking').length, 0);
            assert.equal(f.client._speakingTileTimers.size, 0); assert.equal(f.client._speakingParticipantTimers.size, 0);
            f.client.handleAudioVolume({ peer_id: 'peer:one', audioVolume: 7 });
            f.client.clearSpeakingPeer('peer:one'); clock.tick(700);
            assert.equal(f.document.querySelectorAll('.speaking').length, 0);
            assert.equal(f.client._speakingParticipantTimers.size, 0);
        } finally { clock.restore(); f.dom.window.close(); }
    });
    it('honors the saved highlight toggle and never marks a screen notice or hidden source as speaking', () => {
        const clock = sinon.useFakeTimers();
        const f = fixture('<div id="videoMediaContainer"><div class="Camera local-screen-share-notice" data-peer-id="one"><video hidden></video></div><div class="Camera" data-peer-id="one" data-media-type="screenType"></div><div class="Camera" data-peer-id="one" hidden></div><div id="camera" class="Camera" data-peer-id="one"></div></div><div id="videoPinMediaContainer"></div>');
        try {
            f.context.isSpeakingHighlightEnabled = false;
            f.client.handleAudioVolume({ peer_id: 'one', audioVolume: 7 });
            assert.equal(f.document.querySelectorAll('.speaking').length, 0);
            f.context.isSpeakingHighlightEnabled = true;
            f.client.handleAudioVolume({ peer_id: 'one', audioVolume: 7 });
            assert.deepEqual(Array.from(f.document.querySelectorAll('.speaking'), node => node.id), ['camera']);
            f.client.clearSpeakingTiles(); assert.equal(f.client._speakingTileTimers.size, 0);
            assert.equal(f.document.querySelectorAll('.speaking').length, 0);
        } finally { clock.restore(); f.dom.window.close(); }
    });
});
