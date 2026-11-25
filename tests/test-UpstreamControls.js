'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');
const room = read('public/js/Room.js'), clientSource = read('public/js/RoomClient.js');
function fixture(html) {
    const dom = new JSDOM(html), document = dom.window.document;
    const context = vm.createContext({ document, window: dom.window, console,
        pinVideoPosition: { value: 'speaker-left' }, isBroadcastingEnabled: false, isPresenter: false,
        setColor() {}, handleAspectRatio() {}, setParticipantViewMode() {}, clearTimeout,
    });
    vm.runInContext(clientSource + ';globalThis.proto = RoomClient.prototype;', context);
    const client = Object.assign(Object.create(context.proto), {
        getId: id => document.getElementById(id), isMobileDevice: false,
        refreshPinLabels() {}, setTippy() {}, sound() {}, toggleVideoPin() {}, resizeVideoMenuBar() {},
        scheduleParticipantViewRestore() {}, videoMediaContainerUnpin() {}, transcription: { isPin: () => false },
    });
    context.rc = client;
    return { dom, document, context, client };
}
describe('selected upstream control improvements', () => {
    it('switches pins without losing tile classes, hidden source state or grid dimensions', () => {
        const f = fixture('<div id="grid"><div id="a-tile" class="Camera local-screen-share-notice" style="width:40%;height:20%"><video id="a" hidden></video></div><div id="b-tile" class="Camera custom"><video id="b"></video></div></div><div id="pinned"></div><button id="a__pin"></button><button id="b__pin"></button>');
        try {
            Object.assign(f.client, { videoMediaContainer: f.document.getElementById('grid'), videoPinMediaContainer: f.document.getElementById('pinned') });
            f.client.handlePN('a', 'a__pin', 'a-tile', true);
            f.client.handlePN('b', 'b__pin', 'b-tile');
            f.document.getElementById('a__pin').click();
            assert.equal(f.client.pinnedVideoPlayerId, 'a');
            assert(f.document.getElementById('a-tile').classList.contains('local-screen-share-notice'));
            f.document.getElementById('b__pin').click();
            assert.equal(f.client.pinnedVideoPlayerId, 'b');
            assert.equal(f.document.getElementById('a-tile').parentNode.id, 'grid');
            assert.equal(f.document.getElementById('a-tile').style.width, '40%');
            assert.equal(f.document.getElementById('a-tile').style.height, '20%');
            assert(f.document.getElementById('a').hidden);
            assert(f.document.getElementById('b-tile').classList.contains('custom'));
            f.document.getElementById('b__pin').click();
            assert.equal(f.client.isVideoPinned, false);
            assert.equal(f.client.restorePinnedVideoToGrid, null);
        } finally { f.dom.window.close(); }
    });
    it('locks the emoji picker on mouse click, keeps it open through selection/hover exit and closes outside', () => {
        const f = fixture('<button id="chatEmojiButton"></button><div id="chatEmoji"></div><textarea id="message"></textarea>');
        const clock = sinon.useFakeTimers();
        try {
            let pickerOptions, outside;
            Object.assign(f.context, { isMobileDevice: false, chatEmojiButton: f.document.getElementById('chatEmojiButton'),
                chatMessage: f.document.getElementById('message'), getId: id => f.document.getElementById(id),
                EmojiMart: { Picker: function (options) { pickerOptions = options; return f.document.createElement('div'); } },
                handleClickOutside: (_picker, _button, callback) => { outside = callback; },
                setTimeout, clearTimeout,
            });
            let a = room.indexOf('    chatEmojiButton.onclick ='), b = room.indexOf('    chatMarkdownButton.onclick', a);
            vm.runInContext(room.slice(a, b), f.context);
            a = room.indexOf('function handleChatEmojiPicker()'); b = room.indexOf('function handleRoomEmojiPicker()', a);
            vm.runInContext(room.slice(a, b) + '\nhandleChatEmojiPicker();', f.context);
            const button = f.document.getElementById('chatEmojiButton');
            button.dispatchEvent(new f.dom.window.MouseEvent('mouseenter'));
            assert.equal(f.client.isChatEmojiOpen, true);
            button.dispatchEvent(new f.dom.window.MouseEvent('click', { detail: 1 }));
            assert.equal(f.client.isChatEmojiLocked, true);
            pickerOptions.onEmojiSelect({ native: '👍' });
            button.dispatchEvent(new f.dom.window.MouseEvent('mouseleave')); clock.tick(350);
            assert.equal(f.client.isChatEmojiOpen, true);
            assert.equal(f.document.getElementById('message').value, '👍');
            outside();
            assert.equal(f.client.isChatEmojiOpen, false);
            assert.equal(f.client.isChatEmojiLocked, false);
            button.click();
            assert.equal(f.client.isChatEmojiOpen, true, 'keyboard activation opens the picker');
            button.click(); assert.equal(f.client.isChatEmojiOpen, false);
        } finally { clock.restore(); f.dom.window.close(); }
    });
    it('defaults missing toolbar settings to visible while preserving a saved false preference', () => {
        const a = room.indexOf('const storedSettings ='), b = room.indexOf('const locallyHiddenPeerIds', a);
        for (const saved of [null, {}, { keep_buttons_visible: false }, { keep_buttons_visible: true }]) {
            const context = { lS: { getLocalStorageSettings: () => saved, SFU_SETTINGS: { keep_buttons_visible: true } } };
            vm.runInNewContext(room.slice(a, b) + ';globalThis.result = localStorageSettings.keep_buttons_visible;', context);
            assert.equal(context.result, saved?.keep_buttons_visible ?? true);
        }
    });
    it('routes the extra Share media button to the existing local-media interface', () => {
        const f = fixture('<button id="shareMediaExtraButton"></button>');
        try {
            const calls = [];
            Object.assign(f.context, { getId: id => f.document.getElementById(id), rc: { shareVideo: target => calls.push(target) } });
            const a = room.indexOf("    getId('shareMediaExtraButton').onclick"), b = room.indexOf('\n', a);
            vm.runInContext(room.slice(a, b), f.context);
            f.document.getElementById('shareMediaExtraButton').click();
            assert.deepEqual(calls, ['all']);
            assert(read('public/views/Room.html').includes('fas fa-photo-film'));
        } finally { f.dom.window.close(); }
    });
});
