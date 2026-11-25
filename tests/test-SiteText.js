'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const site = require('../app/src/SiteText');
const HtmlInjector = require('../app/src/HtmlInjector');
const { brandingValues } = require('../app/src/Branding');
const { siteMetadata } = require('../app/src/SiteMetadata');
const help = require('../app/src/Help');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const blockKeys = ['SITE_DESCRIPTION', 'JOIN_DESCRIPTION', 'NEW_ROOM_DESCRIPTION', 'LOGIN_INSTRUCTIONS', 'HELP_LOGIN_INSTRUCTIONS'];
const inlineKeys = ['SITE_NAME', 'SITE_COPYRIGHT', 'NEW_ROOM_TITLE', 'LOGIN_HEADING', 'JOIN_BUTTON_LABEL', 'CUSTOMIZE_BUTTON_LABEL', 'JOIN_LAST_LABEL', 'LOGIN_BUTTON_LABEL'];
const metadataKeys = ['PAGE_TITLE', 'META_DESCRIPTION', 'OG_TITLE', 'OG_DESCRIPTION'];
const locales = ['en-CA', 'ja', 'fr-CA'];
function config() {
    const base = JSON.parse(JSON.stringify(require('../app/src/config').ui.brand));
    base.app.languages = locales;
    base.siteTranslations = {};
    base.brandingSettings = {};
    for (const [index, language] of locales.entries()) {
        const name = ['Employees', '従業員', 'Employés'][index];
        const values = {};
        for (const key of blockKeys) values[key] = `<p><strong>${name}</strong></p><ul><li>Customers</li></ul>`;
        for (const key of inlineKeys) values[key] = `<strong>${name}</strong><br><em>Meetings</em>`;
        for (const key of metadataKeys) values[key] = `<strong>${name}</strong><br>Metadata`;
        base.siteTranslations[language] = values;
        base.brandingByLanguage[language] = brandingValues({}, base.siteTranslations, language);
        base.metadataByLanguage[language] = siteMetadata({}, base.siteTranslations, language);
    }
    return base;
}
function render(page, brand, language) {
    const injector = Object.create(HtmlInjector.prototype);
    injector.config = brand;
    injector.cache = { page: read(`public/views/${page}.html`) };
    let output;
    injector.injectHtml('page', { req: { headers: { 'accept-language': language } }, send(html) { output = html; } });
    return output;
}
function load(html) {
    const dom = new JSDOM(html, { url: 'https://meet.example/', runScripts: 'outside-only' });
    dom.window.eval(read('public/vendor/dompurify/dist/purify.min.js'));
    dom.window.eval(read('public/js/SiteText.js'));
    return dom;
}
describe('shared formatting policies for all site translation variables', () => {
    it('applies block, inline and plain policies consistently in both runtimes for all 17 variables', () => {
        const dom = load(''), client = dom.window.KaigiSiteText, purifier = dom.window.DOMPurify;
        try {
            const raw = '<p><strong>Alpha</strong><br><em>Beta</em></p><ul><li>Gamma</li></ul>';
            for (const key of [...blockKeys, ...inlineKeys, ...metadataKeys]) {
                const clean = site.html(raw, key);
                assert.equal(client.html(raw, key, purifier), clean, key);
                const template = dom.window.document.createElement('template'); template.innerHTML = clean;
                if (blockKeys.includes(key)) assert(template.content.querySelector('ul li'), key);
                else if (inlineKeys.includes(key)) {
                    assert(template.content.querySelector('strong'), key);
                    assert.equal(template.content.querySelector('p, ul, li'), null, key);
                } else {
                    assert.equal(template.content.childElementCount, 0);
                    assert.equal(template.content.textContent, 'Alpha Beta Gamma');
                }
            }
            assert.equal(site.plain(raw), 'Alpha Beta Gamma');
        } finally { dom.window.close(); }
    });
    it('matches server-rendered slots, metadata, icons and accessible labels after live language changes', () => {
        const brand = config();
        for (const page of ['login', 'landing', 'newroom', 'about']) for (const initial of locales) {
            const dom = load(render(page, brand, initial));
            try {
                const w = dom.window, document = w.document;
                function check(language) {
                    const values = brand.brandingByLanguage[language];
                    for (const [id, key] of Object.entries(site.fields)) {
                        const element = document.getElementById(id);
                        if (!element) continue;
                        const expected = site.html(key === 'SITE_DESCRIPTION' ? values.APP_DESCRIPTION ?? values[key] : values[key], key);
                        assert.equal(element.innerHTML, expected, `${page}/${language}/${id}`);
                    }
                    assert.equal(document.title, brand.metadataByLanguage[language].PAGE_TITLE);
                    assert.equal(document.querySelector('meta[name="description"]').content, brand.metadataByLanguage[language].META_DESCRIPTION);
                    for (const [id, key] of Object.entries({ loginButton: 'LOGIN_BUTTON_LABEL', joinSelectRoomButton: 'JOIN_BUTTON_LABEL', joinRoomButton: 'JOIN_BUTTON_LABEL', customizeRoomButton: 'CUSTOMIZE_BUTTON_LABEL' })) {
                        const button = document.getElementById(id);
                        if (button) assert.equal(button.getAttribute('aria-label'), site.plain(values[key]), id);
                    }
                    for (const logo of document.querySelectorAll('[data-brand-logo]'))
                        assert.equal(logo.alt, site.plain(values.SITE_NAME));
                    if (page === 'login') {
                        assert(document.querySelector('#loginBtnText > i'));
                        assert(document.getElementById('loginBtnLoader'));
                    }
                }
                check(initial);
                w.eval(read('public/js/Brand.js').replace(/\ninitialize\(\);\s*$/, '') + '\nbaseSiteBrand = ' + JSON.stringify(brand) + ';');
                for (const language of locales) { w.applySiteTranslations(language); check(language); }
            } finally { dom.window.close(); }
        }
    });
    it('uses formatted fallback branding as readable metadata without replacing explicit metadata overrides', () => {
        const fallback = siteMetadata({ SITE_NAME: '<strong>FreeGateway</strong><br>Meetings', SITE_DESCRIPTION: '<p>One</p><p>Two</p>' });
        assert.equal(fallback.PAGE_TITLE, 'FreeGateway Meetings');
        assert.equal(fallback.META_DESCRIPTION, 'One Two');
        const explicit = siteMetadata({ SITE_NAME: '<strong>Site</strong>', META_DESCRIPTION: '<em>Exact</em> metadata', OG_DESCRIPTION: '' });
        assert.equal(explicit.META_DESCRIPTION, 'Exact metadata'); assert.equal(explicit.OG_DESCRIPTION, '');
    });
    it('formats help illustrations and help-only instructions while keeping the document title plain', () => {
        const brand = config();
        for (const language of locales) {
            const dom = new JSDOM(help.renderHelp(brand, language));
            try {
                assert(dom.window.document.querySelector('.help-instructions li ul li'));
                assert(dom.window.document.querySelector('.help-identity strong'));
                assert(dom.window.document.querySelector('#loginHeading strong'));
                assert(!dom.window.document.title.includes('<'));
                assert(!dom.window.document.querySelector('[onclick]'));
            } finally { dom.window.close(); }
        }
    });
    it('does not admit scripts, attributes or external resources in any policy', () => {
        const dom = load('');
        try {
            for (const key of [...blockKeys, ...inlineKeys, ...metadataKeys]) {
                const raw = '<p id="loginButton" style="display:none" data-x="a"><strong onclick="x()">Safe</strong><img src="https://external.invalid/a"></p><script>x()</script><svg onload="x()"></svg>';
                const html = site.html(raw, key), template = dom.window.document.createElement('template');
                template.innerHTML = html;
                assert.equal(template.content.querySelector('script, img, svg, [id], [style], [onclick], [data-x]'), null);
                assert.equal(html, dom.window.KaigiSiteText.html(raw, key, dom.window.DOMPurify));
            }
        } finally { dom.window.close(); }
    });
});
