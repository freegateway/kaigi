'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');
const source = read('public/js/Room.js');

describe('pre-meeting identity with the shipped SweetAlert dialog', () => {
    let dom;
    afterEach(() => { dom?.window.Swal.close(); dom?.window.close(); });
    async function open(fixed = true) {
        dom = new JSDOM('<div id="initUser"></div><div id="loading"></div>', {
            url: 'https://meet.example/', runScripts: 'outside-only', pretendToBeVisual: true,
        });
        const w = dom.window, document = w.document;
        w.scrollTo = () => {};
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.eval(read('public/vendor/sweetalert2/dist/sweetalert2.all.js'));
        const style = document.createElement('style');
        style.textContent = read('public/css/Room.css');
        document.head.appendChild(style);
        Object.assign(w, {
            force_peer_name: fixed, swalBackground: '#000', BRAND: { app: { name: 'Kaigi' } },
            default_name: 'Employee <Example>', room_id: 'Customer Inc', preMeetingRecordingAllowed: true,
            initUser: document.getElementById('initUser'), loadingDiv: document.getElementById('loading'),
            getId: id => document.getElementById(id), hide: element => { element.hidden = true; },
            updateInitVideoOffAvatar() {}, showMobileAudioGuidance() {},
            isVideoAllowed: false, isInitVideoLoaded: true,
            filterXSS: value => value, isHtml: () => false, getCookie: () => 'existing', setCookie() {},
            isValidEmail: () => false,
        });
        w.sessionStorage.mirotalk_displayname = fixed ? w.default_name : '';
        w.sessionStorage.mirotalk_login_name = 'employee';
        const start = source.indexOf('    Swal.fire({', source.indexOf('// The HARDENED attendee name'));
        const end = source.indexOf('    }).then(async () => {', start);
        assert(start > 0 && end > start);
        w.eval(source.slice(start, end) + '    });');
        await new Promise(resolve => w.setTimeout(resolve, 30));
        return w;
    }
    it('shows three plain-text identity rows without a duplicate label or visible text input', async () => {
        const w = await open(), panel = w.document.querySelector('.init-identity-panel');
        assert.equal(w.document.querySelector('.swal2-input-label'), null);
        assert.deepEqual(Array.from(panel.querySelectorAll('dt'), row => row.textContent), ["User's display name:", "User's login name:", 'Meeting name:']);
        const values = panel.querySelectorAll('dd > strong');
        assert.equal(values.length, 3);
        assert.deepEqual(Array.from(values, value => value.textContent), ['Employee <Example>', 'employee', 'Customer Inc']);
        assert.equal(values[0].querySelector('example'), null);
        const input = w.document.getElementById('usernameInput');
        assert.equal(input.id, 'usernameInput');
        assert.equal(input.hidden, true);
        assert.equal(input.readOnly, true);
        assert.equal(input.disabled, false);
        assert.equal(w.getComputedStyle(input).display, 'none');
        assert.equal(input.value, 'Employee <Example>');
        w.Swal.clickConfirm();
        await new Promise(resolve => w.setTimeout(resolve, 10));
        assert.equal(w.peer_name, 'Employee <Example>');
    });
    it('retains a single correctly associated input label for an editable fallback', async () => {
        const w = await open(false), input = w.document.getElementById('usernameInput');
        assert.equal(w.document.querySelector('.swal2-input-label'), null);
        assert.equal(w.document.querySelector('label[for="usernameInput"]').textContent, "User's display name:");
        assert.equal(input.hidden, false);
        assert.equal(input.readOnly, false);
    });
});
