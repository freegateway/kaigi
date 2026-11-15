'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const security = require('../app/src/SecurityPage');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

describe('Security navigation and queued presentation fixes', () => {
    it('renders the canonical two-paragraph Fail2ban section with an explicit project link', () => {
        for (const lang of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const doc = new JSDOM(security.renderSecurity({}, lang)).window.document;
            const heading = doc.getElementById('security-section-5');
            const first = heading.nextElementSibling;
            const second = first.nextElementSibling;
            assert.equal(first.tagName, 'P');
            assert.equal(second.tagName, 'P');
            assert.equal(second.nextElementSibling.id, 'security-section-6');
            const link = first.querySelector('a[href="https://github.com/fail2ban/fail2ban"]');
            assert.equal(link.textContent, 'Fail2ban');
            assert(second.querySelector('.security-path'));
            if (lang.startsWith('en')) {
                assert(first.textContent.includes('temporarily block connections from those IP addresses'));
                assert(second.textContent.startsWith('To facilitate Fail2ban configuration'));
            }
        }
    });
    it('maps every localized section to exactly one numbered contents link without scripts', () => {
        for (const lang of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const doc = new JSDOM(security.renderSecurity({}, lang)).window.document;
            const links = [...doc.querySelectorAll('.security-sidebar nav ol a')];
            const headings = [...doc.querySelectorAll('main h2[id]')];
            assert.equal(links.length, 7);
            assert.equal(headings.length, links.length);
            assert(doc.querySelector('.security-sidebar details[open] > summary'));
            assert(doc.querySelector('.security-sidebar nav').getAttribute('aria-label'));
            links.forEach((link, index) => {
                const id = link.getAttribute('href').slice(1);
                assert.equal(doc.querySelectorAll('#' + id).length, 1);
                assert.equal(link.textContent, headings[index].textContent);
            });
            const code = doc.querySelector('code.security-path');
            assert.equal(code.textContent, '/usr/local/share/kaigi/fail2ban/');
            assert.equal(code.getAttribute('tabindex'), '0');
            assert.equal(doc.querySelectorAll('script').length, 1);
        }
        const css = read('public/css/security.css');
        for (const value of ['white-space: nowrap', 'overflow-x: auto', 'word-break: normal', '@media (max-width: 900px)', '.security-sidebar { display: none; }']) assert(css.includes(value), value);
    });
    it('styles only read-only identity inputs as text without disabling them', () => {
        const css = read('public/css/Room.css');
        const rule = css.match(/\.init-identity-panel \.swal2-input:read-only\s*\{[^}]+\}/)[0];
        const dom = new JSDOM(`<style>.swal2-input { background: blue; font-weight: 400; }${rule}</style><div class="init-identity-panel"><input id="fixed" class="swal2-input" readonly value="Authenticated name"><input id="edit" class="swal2-input"></div>`);
        const fixed = dom.window.document.getElementById('fixed');
        assert.equal(dom.window.getComputedStyle(fixed).fontWeight, '600');
        assert.equal(dom.window.getComputedStyle(fixed).backgroundColor, 'rgba(0, 0, 0, 0)');
        assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('edit')).fontWeight, '400');
        assert.equal(fixed.value, 'Authenticated name');
        assert.equal(fixed.disabled, false);
        assert.equal(fixed.readOnly, true);
        assert(read('public/js/Room.js').includes("getId('usernameInput').readOnly = true"));
    });
    it('ships an SSH-readable plain-text Fail2ban guide with no Markdown fences or links', () => {
        const guide = read('packaging/freebsd/fail2ban/README.txt');
        assert(!/```|^#{1,6} |\[[^\]]+\]\(https?:/m.test(guide));
        for (const text of ['kaigi-pf', 'kaigi-ipfw', 'fail2ban-client -t', '[Definition]', 'ignoreip']) assert(guide.includes(text));
        assert(!fs.existsSync(path.join(__dirname, '../packaging/freebsd/fail2ban/README.md')));
    });
});
