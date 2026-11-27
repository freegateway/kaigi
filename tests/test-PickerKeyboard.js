'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const clientSource = fs.readFileSync(require.resolve('../public/js/RoomClient.js'), 'utf8');
const roomSource = fs.readFileSync(require.resolve('../public/js/Room.js'), 'utf8');
describe('picker keyboard controls', () => {
    let dom, document, context, client;
    beforeEach(() => {
        dom = new JSDOM('<button id="emojiRoomButton"></button><div id="emojiPickerContainer"></div><button id="chatEmojiButton"></button><div id="chatEmoji"></div><textarea id="message"></textarea>');
        document = dom.window.document;
        context = vm.createContext({ window: dom.window, document, console, setTimeout, clearTimeout,
            setColor() {}, isMobileDevice: true, peer_name: 'Alice', getId: id => document.getElementById(id),
            emojiRoomButton: document.getElementById('emojiRoomButton'), emojiPickerContainer: document.getElementById('emojiPickerContainer'),
            chatEmojiButton: document.getElementById('chatEmojiButton'), chatMessage: document.getElementById('message'),
            EmojiMart: { Picker: function () { return document.createElement('div'); } }, handleClickOutside() {},
        });
        dom.window.i18n = { t: key => ({ Close: '閉じる', Emoji: '絵文字', 'Room Emoji': 'ミーティングの絵文字' }[key] || key) };
        vm.runInContext(clientSource + ';globalThis.Client = RoomClient;', context);
        client = Object.create(context.Client.prototype);
        client.getId = id => document.getElementById(id);
        context.rc = client;
    });
    afterEach(() => dom.window.close());
    const key = (target, value) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    it('navigates native reaction buttons and returns focus on Escape and selection', () => {
        document.body.insertAdjacentHTML('beforeend', '<li id="msg-7"><button id="msg-react-7"></button><div class="message-reactions"></div><div id="reaction-picker-7" class="reaction-picker" style="display:none"><button class="reaction-emoji-btn">👍</button><button class="reaction-emoji-btn">❤️</button></div></li>');
        client.peer_name = 'Alice'; client.applyReactionToElement = () => {};
        client.toggleReactionPicker('msg-7');
        const buttons = document.querySelectorAll('.reaction-emoji-btn');
        assert.equal(document.activeElement, buttons[0]);
        key(buttons[0], 'ArrowLeft'); assert.equal(document.activeElement, buttons[1]);
        key(buttons[1], 'ArrowRight'); assert.equal(document.activeElement, buttons[0]);
        key(buttons[0], 'Escape'); assert.equal(document.activeElement.id, 'msg-react-7');
        assert.equal(document.getElementById('reaction-picker-7').style.display, 'none');
        client.toggleReactionPicker('msg-7'); client.sendChatReaction('msg-7', '👍');
        assert.equal(document.activeElement.id, 'msg-react-7');
    });
    it('moves between meeting emoji tabs and sounds, localizes names and returns focus on dismissal', () => {
        const begin = roomSource.indexOf('function handleRoomEmojiPicker()');
        const end = roomSource.indexOf('function handleEditor()', begin);
        vm.runInContext(roomSource.slice(begin, end) + ';handleRoomEmojiPicker();', context);
        const trigger = document.getElementById('emojiRoomButton');
        trigger.click(); assert.equal(document.activeElement.id, 'roomEmojiAllTab');
        key(document.activeElement, 'ArrowRight'); assert.equal(document.activeElement.id, 'roomEmojiSoundTab');
        assert.equal(document.activeElement.getAttribute('aria-selected'), 'true');
        assert.equal(document.getElementById('roomEmojiAllTab').tabIndex, -1);
        const sounds = document.querySelectorAll('.room-emoji-btn');
        assert.equal(sounds[0].type, 'button'); assert.match(sounds[0].getAttribute('aria-label'), /絵文字/);
        sounds[0].focus(); key(sounds[0], 'ArrowLeft'); assert.equal(document.activeElement, sounds[sounds.length - 1]);
        key(document.activeElement, 'Home'); assert.equal(document.activeElement, sounds[0]);
        key(document.activeElement, 'Escape'); assert.equal(document.activeElement, trigger);
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        trigger.click();
        const close = document.querySelector('.room-emoji-close-btn');
        assert.equal(close.getAttribute('aria-label'), '閉じる');
        close.click(); assert.equal(document.activeElement, trigger);
    });
    it('dismisses the chat emoji picker with Escape from outside and resets its click lock', () => {
        const begin = roomSource.indexOf('function handleChatEmojiPicker()');
        const end = roomSource.indexOf('function handleRoomEmojiPicker()', begin);
        vm.runInContext(roomSource.slice(begin, end) + ';handleChatEmojiPicker();', context);
        client.setChatEmojiOpen(true); client.setChatEmojiLocked(true);
        document.getElementById('message').focus(); key(document.activeElement, 'Escape');
        assert.equal(client.isChatEmojiOpen, false); assert.equal(client.isChatEmojiLocked, false);
        assert.equal(document.activeElement.id, 'chatEmojiButton');
    });
});
