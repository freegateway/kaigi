'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('compact pre-meeting layout', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    it('limits compact rules to the preparation dialog without changing device or join behavior', () => {
        const document = new JSDOM('<style></style>').window.document;
        const style = document.querySelector('style');
        const source = read('public/css/Room.css');
        style.textContent = source.slice(source.indexOf('/* Compact only the pre-meeting dialog'));
        const sheet = style.sheet;
        const media = [...sheet.cssRules].filter((rule) => rule.media?.mediaText.includes('max-height: 760px'));
        assert.equal(media.length, 2);
        for (const group of media) {
            for (const rule of group.cssRules) {
                for (const selector of rule.selectorText.split(',')) assert(selector.includes('.init-modal-size'));
                assert.doesNotMatch(rule.style.cssText, /font-size|transform|overflow:\s*hidden|position:\s*fixed/);
            }
        }
        const compact = media[0].cssText;
        assert.match(compact, /max-height: calc\(100dvh - 24px\)/);
        assert.match(compact, /overflow-y: auto/);
        assert.match(compact, /object-fit: contain/);
        assert.match(compact, /#usernameInput/);
        assert.match(media[1].media.mediaText, /min-width: 700px/);
        const columns = [...media[1].cssRules].find((rule) => rule.selectorText.includes('.init-user.no-camera'));
        // Zero lengths may serialize with or without px; both tracks must remain equal.
        assert.match(
            columns.style.getPropertyValue('grid-template-columns'),
            /^minmax\(0(?:px)?, 1fr\) minmax\(0(?:px)?, 1fr\)$/
        );
        assert.match(media[1].cssText, /\.no-camera/);
        assert.match(media[1].cssText, /\.mic-guidance/);
        const html = read('public/views/Room.html');
        for (const id of ['initVideoSelect', 'initMicrophoneSelect', 'initSpeakerSelect']) {
            assert.match(html, new RegExp(`id="${id}"`));
        }
    });
});
