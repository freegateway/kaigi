'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const HtmlInjector = require('../app/src/HtmlInjector');
const format = require('../app/src/LoginInstructions');
const help = require('../app/src/Help');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const allowed = new Set(['P', 'BR', 'STRONG', 'EM', 'UL', 'OL', 'LI']);
const examples = {
    'en-CA': '<p><strong>Employees:</strong> Use your email address.</p><p><em>Customers:</em> Use your assigned login name.</p>',
    ja: '<p><strong>従業員:</strong> メールアドレスを入力してください。</p><ul><li>お客様は指定されたログイン名を使用してください。</li></ul>',
    'fr-CA': '<p><strong>Employés :</strong> Utilisez votre adresse courriel.</p><ol><li>Clients : utilisez votre nom de connexion.</li></ol>',
};
const attacks = [
    '<p id="loginButton" class="x" style="color:red" onclick="alert(1)" data-x="1" aria-label="x">Safe<br autofocus><strong title="x">text</strong></p>',
    '</div><script>alert(1)</script><iframe src="https://external.invalid/"></iframe><img src="https://external.invalid/a" onerror="alert(1)"><p>Safe</p>',
    '<svg><a xlink:href="javascript:alert(1)"><text>SVG</text></a></svg><math><mtext><img src=x onerror=alert(1)></mtext></math><em>Safe</em>',
    '<form action="https://external.invalid/"><input name="username"><button>Submit</button></form><a href="javascript:alert(1)">Text</a>',
    '<p><em>one<strong>two</p>three</strong></em><style>body{display:none}</style>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">text</p></noscript>',
];
function brand(instructions = examples) {
    const base = JSON.parse(JSON.stringify(require('../app/src/config').ui.brand));
    base.app.languages = ['en-CA', 'ja', 'fr-CA'];
    for (const [language, value] of Object.entries(instructions)) {
        base.brandingByLanguage[language] = { ...base.brandingByLanguage[language], LOGIN_INSTRUCTIONS: value };
        base.siteTranslations ||= {};
        base.siteTranslations[language] = { ...base.siteTranslations[language], LOGIN_INSTRUCTIONS: value };
    }
    return base;
}
function render(config, language) {
    const injector = Object.create(HtmlInjector.prototype);
    injector.config = config;
    injector.cache = { page: read('public/views/login.html') };
    let html;
    injector.injectHtml('page', { req: { headers: { 'accept-language': language } }, send(value) { html = value; } });
    return html;
}
function browser(html) {
    const dom = new JSDOM(html, { url: 'https://meet.example/', runScripts: 'outside-only' });
    dom.window.eval(read('public/vendor/dompurify/dist/purify.min.js'));
    dom.window.eval(read('public/js/LoginInstructions.js'));
    return dom;
}

describe('formatted login instructions', () => {
    it('renders the same localized, sanitized blocks initially and after every live language change', () => {
        const config = brand();
        for (const initial of Object.keys(examples)) {
            const dom = browser(render(config, initial));
            try {
                const w = dom.window, doc = w.document;
                const description = doc.getElementById('loginDescription');
                assert.equal(description.tagName, 'DIV');
                assert.equal(description.innerHTML, format(examples[initial]));
                w.eval(read('public/js/Brand.js').replace(/\ninitialize\(\);\s*$/, '') + '\nbaseSiteBrand = ' + JSON.stringify(config) + ';');
                for (const language of Object.keys(examples)) {
                    w.applySiteTranslations(language);
                    assert.equal(description.innerHTML, format(examples[language]));
                    assert(description.querySelector('strong'));
                    assert(description.hasAttribute('data-i18n-skip'));
                    assert.equal(doc.querySelectorAll('#loginButton').length, 1);
                    assert.equal(doc.querySelectorAll('#loginBtnLoader').length, 1);
                }
            } finally { dom.window.close(); }
        }
    });
    it('allows only the seven formatting tags and no attributes through both sanitizer builds', () => {
        const dom = browser('');
        try {
            for (const input of attacks) {
                const server = format(input), client = dom.window.KaigiLoginInstructions(input, dom.window.DOMPurify);
                assert.equal(client, server);
                const template = dom.window.document.createElement('template');
                template.innerHTML = server;
                for (const element of template.content.querySelectorAll('*')) {
                    assert(allowed.has(element.tagName), element.outerHTML);
                    assert.equal(element.attributes.length, 0, element.outerHTML);
                    assert.equal(element.namespaceURI, 'http://www.w3.org/1999/xhtml');
                }
            }
        } finally { dom.window.close(); }
    });
    it('preserves plain text, empty values and text entities and fails safely without a sanitizer', () => {
        const dom = browser('');
        try {
            for (const input of ['', 'Email address & password', 'A < B > C', '日本語 / Français', null]) {
                const template = dom.window.document.createElement('template');
                template.innerHTML = format(input);
                assert.equal(template.content.textContent, String(input ?? ''));
            }
            const input = '<p onclick="x()">Instructions</p>';
            for (const purifier of [undefined, { isSupported: false }, { isSupported: true, sanitize() { throw Error(); } }]) {
                const output = dom.window.KaigiLoginInstructions(input, purifier);
                const template = dom.window.document.createElement('template'); template.innerHTML = output;
                assert.equal(template.content.childElementCount, 0);
                assert.equal(template.content.textContent, input);
            }
        } finally { dom.window.close(); }
    });
    it('keeps template-like administrator text literal instead of expanding it after sanitization', () => {
        const value = '<p>{{KAIGI_ABOUT}} {{APP_NAME}} {{OG_TITLE}}</p>';
        const dom = browser(render(brand({ 'en-CA': value }), 'en-CA'));
        try {
            assert.equal(dom.window.document.getElementById('loginDescription').innerHTML, value);
            assert.equal(dom.window.KaigiLoginInstructions(value, dom.window.DOMPurify), value);
        } finally { dom.window.close(); }
    });
    it('keeps form controls intact and submits login after rendering hostile operator markup', async () => {
        const dom = browser(render(brand({ 'en-CA': attacks.join('') }), 'en-CA'));
        try {
            const w = dom.window, doc = w.document, requests = [];
            assert.equal(doc.querySelectorAll('form[action], iframe, img[src^="https://external"]').length, 0);
            w.axios = { post: (url, body) => { requests.push({ url, username: body.username }); return new Promise(() => {}); } };
            w.eval(read('public/js/Login.js'));
            doc.getElementById('username').value = 'employee@example.invalid';
            doc.getElementById('password').value = 'fixture-password';
            doc.getElementById('loginButton').click();
            assert.deepEqual(requests, [{ url: '/auth/session/login', username: 'employee@example.invalid' }]);
            assert(doc.getElementById('loginBtnLoader').classList.contains('show'));
        } finally { dom.window.close(); }
    });
    it('renders formatting safely in the help illustration without changing help-specific instructions', () => {
        const config = brand();
        config.siteTranslations['en-CA'].HELP_LOGIN_INSTRUCTIONS = 'Literal <strong>help</strong>';
        const dom = new JSDOM(help.renderHelp(config, 'en-CA'));
        try {
            assert.equal(dom.window.document.getElementById('loginDescription').innerHTML, format(examples['en-CA']));
            assert(dom.window.document.body.textContent.includes('Literal <strong>help</strong>'));
        } finally { dom.window.close(); }
    });
    it('ships the exact pinned sanitizer locally before the shared helper and branding scripts', () => {
        const html = read('public/views/login.html');
        assert(html.indexOf('/vendor/dompurify/dist/purify.min.js') < html.indexOf('/js/LoginInstructions.js'));
        assert(html.indexOf('/js/LoginInstructions.js') < html.indexOf('../js/Brand.js'));
        assert.equal(read('public/vendor/dompurify/dist/purify.min.js'), read('node_modules/dompurify/dist/purify.min.js'));
        const crypto = require('node:crypto'), manifest = require('../docs/vendor-files.json');
        for (const name of ['LICENSE', 'dist/purify.min.js', 'dist/purify.min.js.map']) {
            const pathname = 'vendor/dompurify/' + name;
            assert.equal(manifest.files.find(item => item.path === pathname).sha256,
                crypto.createHash('sha256').update(read('public/' + pathname)).digest('hex'));
        }
    });
});
