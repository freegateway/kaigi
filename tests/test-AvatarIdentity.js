'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const Peer = require('../app/src/Peer');
describe('server-owned peer identity and safe avatar rendering', () => {
    const origin = 'https://meet.example';
    const make = avatar => new Peer('real-socket-id', { peer_info: { peer_id: '\"><img src=x onerror=alert(1)>', peer_name: 'Attendee', peer_avatar: avatar } }, origin);
    it('binds participant ID to the connection and normalizes same-origin avatars at join and update', () => {
        const p = make(origin + '/a.png?x=" onerror="alert(1)');
        assert.equal(p.peer_info.peer_id, 'real-socket-id');
        assert.doesNotMatch(p.peer_avatar, /["<>]/);
        const data = { type: 'avatar', status: origin + '/a.png?x="><img>' }; p.updatePeerInfo(data);
        assert.equal(data.status, p.peer_avatar); assert.doesNotMatch(data.status, /["<>]/);
        for (const value of ['https://external.example/a.png', 'data:image/svg+xml,<svg>', 'javascript:alert(1)', '//external/a.png', { url: origin }]) {
            assert.equal(make(value).peer_avatar, false);
            const update = { type: 'avatar', status: value };p.updatePeerInfo(update);assert.equal(update.status, false);
        }
    });
    it('sets avatar and title through DOM APIs rather than parsing participant values as HTML', () => {
        const source = fs.readFileSync(require.resolve('../public/js/RoomClient.js'), 'utf8');
        const start = source.indexOf('        const setChatAbout =');
        const end = source.indexOf('        // CURRENT SELECTED PEER', start);
        const dom = new JSDOM('<div id="header"></div>');
        const header = dom.window.document.getElementById('header');
        const context = { chatAbout: header, generateChatAboutHTML: () => '<img><h6></h6>' };
        vm.runInNewContext(source.slice(start, end) + ';setChatAbout(\'https://meet.example/a?x=" onerror="alert(1)\', \'<img src=x onerror=alert(1)>\');', context);
        assert.equal(header.querySelectorAll('img').length, 1);
        assert.equal(header.querySelector('[onerror]'), null);
        assert.match(header.querySelector('h6').textContent, /<img/);
    });
});
