'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const room = fs.readFileSync(require.resolve('../public/js/Room'), 'utf8');
const client = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
const roomFunction = (name) => room.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))[0];

describe('meeting device and toolbar controls', () => {
    it('leaves the speaker selector unchanged when the microphone is toggled', () => {
        const initMicrophoneSelect = { disabled: false };
        const initSpeakerSelect = { disabled: false };
        const context = vm.createContext({ initMicrophoneSelect, initSpeakerSelect, sound() {} });
        vm.runInContext(roomFunction('checkInitAudio') + '\ncheckInitAudio(false);', context);
        assert.equal(initMicrophoneSelect.disabled, true);
        assert.equal(initSpeakerSelect.disabled, false);
        initSpeakerSelect.disabled = true;
        vm.runInContext('checkInitAudio(true);', context);
        assert.equal(initMicrophoneSelect.disabled, false);
        assert.equal(initSpeakerSelect.disabled, true);
    });

    it('resizes only when the always-visible bottom bar changes its reserved height', () => {
        const { window } = new JSDOM('<div id="bottomButtons" style="margin-bottom: 16px"></div>');
        const { document } = window;
        const bottomButtons = document.getElementById('bottomButtons');
        const localStorageSettings = { keep_buttons_visible: false };
        let height = 44;
        let resizes = 0;
        Object.defineProperty(bottomButtons, 'offsetHeight', { get: () => height });
        const context = vm.createContext({
            document, bottomButtons, localStorageSettings,
            getComputedStyle: window.getComputedStyle.bind(window),
            resizeVideoMedia: () => resizes++,
        });
        vm.runInContext('let buttonsBarReserve = 0;\n' + roomFunction('syncButtonsBarReserve'), context);
        const sync = () => vm.runInContext('syncButtonsBarReserve()', context);
        const reserve = () => document.documentElement.style.getPropertyValue('--buttons-bar-reserve');
        sync();
        assert.equal(resizes, 0);
        localStorageSettings.keep_buttons_visible = true;
        sync();
        assert.equal(reserve(), '66px');
        sync();
        assert.equal(resizes, 1);
        height = 88;
        sync();
        assert.equal(reserve(), '110px');
        bottomButtons.dataset.position = 'horizontal';
        sync();
        assert.equal(reserve(), '0px');
        bottomButtons.dataset.position = 'vertical';
        sync();
        assert.equal(reserve(), '110px');
        localStorageSettings.keep_buttons_visible = false;
        sync();
        assert.equal(reserve(), '0px');
        height = 0;
        sync();
        assert.equal(resizes, 5);
        window.close();
    });

    it('reserves space only in pinned sections that reach the bottom and resets on unpin', () => {
        const { window } = new JSDOM('<div id="grid"></div><div id="pinned"></div>');
        const context = vm.createContext({ window, resizeVideoMedia() {} });
        const proto = vm.runInContext(client + '\nRoomClient.prototype', context);
        const grid = window.document.getElementById('grid');
        const pinned = window.document.getElementById('pinned');
        const state = {
            videoMediaContainer: grid,
            videoPinMediaContainer: pinned,
            isVideoPinned: true,
            getPinnedSidePanelWidth: () => 25,
            resizeVideoMenuBar() {},
        };
        const exempt = () => [grid, pinned].map((element) => element.classList.contains('no-bar-reserve'));
        for (const [position, expected] of [
            ['speaker-top', [false, true]], ['speaker-bottom', [true, false]],
            ['speaker-left', [false, false]], ['speaker-right', [false, false]],
            ['speaker-1:1', [false, false]],
        ]) {
            proto.toggleVideoPin.call(state, position);
            assert.deepEqual(exempt(), expected, position);
        }
        proto.toggleVideoPin.call(state, 'speaker-bottom');
        proto.videoMediaContainerUnpin.call(state);
        assert.deepEqual(exempt(), [false, false]);
        window.close();
    });
});
