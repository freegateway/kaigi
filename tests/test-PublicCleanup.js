'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const security = require('../app/src/SecurityPage');
const help = require('../app/src/Help');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('public page cleanup', () => {
    it('shares standalone styling without changing the meeting popup layout', () => {
        const about = new JSDOM(read('public/views/about.html')).window.document;
        const page = new JSDOM(security.renderSecurity()).window.document;
        for (const doc of [about, page]) {
            assert(doc.body.classList.contains('public-page'));
            assert(doc.querySelector('main.about-local'));
            assert(doc.querySelector('footer.public-footer'));
            assert(doc.querySelector('link[href="/css/public-page.css"]'));
            assert.equal(doc.querySelector('style'), null);
            assert(doc.querySelector('#publicBack.button.button-primary[href="/login"]'));
        }
        assert(!read('public/views/Room.html').includes('/css/public-page.css'));
        const css = read('public/css/public-page.css');
        assert(css.includes('@media (max-height: 760px)'));
        assert(!css.includes('position: fixed'));
    });
    it('uses the corrected security label and localized Back buttons and Fail2ban explanations', () => {
        for (const lang of ['en', 'en-CA', 'ja', 'fr-CA']) {
            const guide = new JSDOM(help.renderHelp({}, lang)).window.document;
            const page = new JSDOM(security.renderSecurity({}, lang)).window.document;
            const dictionary = require('../public/lang/' + lang + '.json');
            assert.equal(guide.querySelector('#publicBack').textContent, dictionary.about.back);
            assert.equal(page.querySelector('#publicBack').textContent, dictionary.about.back);
            assert(page.body.textContent.includes('Fail2ban'));
            assert(page.body.textContent.includes('/usr/local/share/kaigi/fail2ban/'));
            assert(!guide.body.textContent.includes('The illustrated buttons and menus do not work'));
        }
        assert.equal(new JSDOM(security.renderSecurity()).window.document.querySelector('main h2').textContent, 'Security & Privacy');
    });
    it('goes Back only for a same-origin referrer and usable history; otherwise keeps the login fallback', () => {
        for (const [referrer, length, expected] of [
            ['https://kaigi.invalid/meeting', 2, 1], ['https://outside.invalid/', 2, 0], ['', 2, 0],
            ['https://kaigi.invalid/login', 1, 0],
        ]) {
            let handler, prevented = 0, back = 0;
            vm.runInNewContext(read('public/js/Help.js'), {
                URL, navigator: { languages: ['en'] }, localStorage: { getItem: () => null },
                document: { referrer, documentElement: { dataset: { helpLanguages: '["en"]', helpLanguage: 'en' } },
                    getElementById: id => id === 'publicBack' ? { addEventListener: (_event, fn) => { handler = fn; } } : null },
                window: { history: { length, back: () => back++ }, location: { href: 'https://kaigi.invalid/help', origin: 'https://kaigi.invalid' } },
            });
            handler({ preventDefault: () => prevented++ });
            assert.equal(back, expected);
            assert.equal(prevented, expected);
        }
    });
    it('documents both firewalls without enabling blocking or matching arbitrary client messages', () => {
        const readme = read('packaging/freebsd/fail2ban/README.txt');
        for (const text of ['kaigi-ipfw', 'kaigi-pf', 'fail2ban-regex', 'ignoreip', 'jail', 'table']) assert(readme.includes(text));
        const filter = read('packaging/freebsd/fail2ban/kaigi.conf');
        assert(filter.includes('authentication_failed'));
        assert(filter.includes('invalid_credentials'));
        assert(!filter.includes('socket_event_rejected'));
    });
});
