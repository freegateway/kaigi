'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = (path) => fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');

describe('pin action labels and short-viewport help', () => {
    it('keeps the actual pin button, proxy, caption and tooltip synchronized through pin/unpin and cleanup', () => {
        const dom = new JSDOM(
            '<div id="grid"><div id="camera"><video id="video"></video></div></div><div id="pinned"></div><button id="video__pin"></button><div id="menu"></div>'
        );
        const { document } = dom.window;
        let language = 'en';
        dom.window.i18n = {
            t: (key) => {
                const dictionary = JSON.parse(read(`public/lang/${language}.json`));
                for (const namespace of ['buttons', 'labels', 'tooltips'])
                    if (dictionary[namespace]?.[key]) return dictionary[namespace][key];
                return key;
            },
        };
        const context = vm.createContext({
            window: dom.window,
            document,
            console,
            pinVideoPosition: { value: 'speaker-left' },
            isBroadcastingEnabled: false,
            isPresenter: false,
            setColor() {},
            handleAspectRatio() {},
            setParticipantViewMode() {},
            clearTimeout,
        });
        vm.runInContext(read('public/js/RoomClient.js') + ';globalThis.Prototype = RoomClient.prototype;', context);
        const client = Object.create(context.Prototype);
        Object.assign(client, {
            isMobileDevice: false,
            isVideoPinned: false,
            getId: (id) => document.getElementById(id),
            sound() {},
            toggleVideoPin() {},
            resizeVideoMenuBar() {},
            scheduleParticipantViewRestore() {},
            videoMediaContainerUnpin() {},
            videoPinMediaContainer: document.getElementById('pinned'),
            videoMediaContainer: document.getElementById('grid'),
            transcription: { isPin: () => false },
            setTippy: (id, key) => {
                document.getElementById(id)._tippy = {
                    content: key,
                    setContent(value) {
                        this.content = value;
                    },
                };
            },
        });
        const button = document.getElementById('video__pin');
        const item = client.createResponsiveDropdownItem(button, 'Pin Video', 'compact');
        document.getElementById('menu').appendChild(item);
        client.handlePN('video', button.id, 'camera');
        function check(label, pressed) {
            assert.equal(item.querySelector('span').textContent, label);
            assert.equal(item.querySelector('span').firstChild.__i18nSrc, pressed ? 'Unpin video' : 'Pin video');
            for (const element of [button, item.querySelector('button')]) {
                assert.equal(element.getAttribute('aria-label'), label);
                assert.equal(element.getAttribute('aria-pressed'), String(pressed));
            }
            assert.equal(button._tippy.content, label);
            assert.equal(button._tippy.__i18nSrc, pressed ? 'Unpin video' : 'Pin video');
        }
        check('Pin video', false);
        item.click();
        check('Unpin video', true);
        item.click();
        check('Pin video', false);
        button.click();
        check('Unpin video', true);
        for (const locale of ['ja', 'en-CA', 'fr-CA']) {
            language = locale;
            client.refreshPinLabels();
            check(dom.window.i18n.t('Unpin video'), true);
        }
        client.removeVideoPinMediaContainer();
        check(dom.window.i18n.t('Pin video'), false);
        dom.window.close();
    });
    it('scopes compact height rules to login/chooser and keeps readable controls and document scrolling', () => {
        const css = read('public/css/login.css'),
            html = read('public/views/login.html');
        assert.match(html, /has-animations login-page/);
        const start = css.indexOf('@media (max-height: 760px)');
        assert(start >= 0);
        const compact = css.slice(start);
        for (const selector of ['.site-header', '.login-card', '#joinRoomForm', '#headerLogo', '.site-footer-inner'])
            assert(compact.includes(`.login-page ${selector}`));
        assert.doesNotMatch(compact, /overflow:\s*hidden|position:\s*fixed|transform:\s*scale/);
        assert.match(compact, /padding: 24px/);
        assert.match(compact, /margin: -24px/);
        assert(!compact.includes('.form-input'));
        assert(!compact.includes('.login-btn'));
        assert.match(read('public/css/landing.css'), /overflow: visible/);
    });
    it('documents pin/unpin, self-view and browser picture-in-picture separately in all maintained locales', () => {
        const help = require('../app/src/Help');
        for (const locale of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const document = new JSDOM(help.renderHelp({}, locale)).window.document;
            const topic = document.getElementById('help-video-layout').parentElement;
            assert.equal(topic.querySelectorAll('p').length, 4);
            assert(topic.querySelector('[inert]'));
            assert.equal(topic.querySelectorAll('.help-mini-tiles').length, 2);
            assert(topic.querySelector('.help-mini-pinned'));
            assert(document.querySelector('.help-sidebar a[href="#help-video-layout"]'));
            assert.doesNotMatch(topic.textContent, /\[\[[A-Z_]+\]\]/);
        }
    });
});
