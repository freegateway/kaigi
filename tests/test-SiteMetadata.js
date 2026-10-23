'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const express = require('express');
const HtmlInjector = require('../app/src/HtmlInjector');
const { siteMetadata } = require('../app/src/SiteMetadata');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
function configuredBrand(settings, translations = {}, language = 'en') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-metadata-'));
    try {
        fs.writeFileSync(
            path.join(directory, 'kaigi.conf'),
            Object.entries(settings)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n')
        );
        fs.writeFileSync(path.join(directory, 'site-translations.json'), JSON.stringify(translations));
        const script =
            "const brand=require('./app/src/config.template').ui.brand; process.stdout.write(JSON.stringify(brand));";
        const env = {
            PATH: process.env.PATH,
            KAIGI_CONFIG_DIR: directory,
            SFU_ANNOUNCED_IP: '127.0.0.1',
            UI_LANGUAGE: language,
        };
        return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8' }));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
function render(page, brand, context = {}) {
    const injector = Object.create(HtmlInjector.prototype);
    injector.config = brand;
    injector.cache = { page: read(`public/views/${page}.html`) };
    let result;
    injector.injectHtml(
        'page',
        {
            send: (value) => {
                result = value;
            },
        },
        context
    );
    assert.equal(injector.cache.page, read(`public/views/${page}.html`));
    return result;
}
function check(document, values) {
    assert.equal(document.title, values.PAGE_TITLE);
    for (const [attribute, key, expected] of [
        ['name', 'description', values.META_DESCRIPTION],
        ['property', 'og:title', values.OG_TITLE],
        ['property', 'og:description', values.OG_DESCRIPTION],
        ['name', 'twitter:title', values.OG_TITLE],
        ['name', 'twitter:description', values.OG_DESCRIPTION],
    ]) {
        const tags = document.querySelectorAll(`meta[${attribute}="${key}"]`);
        assert.equal(tags.length, 1, key);
        assert.equal(tags[0].content, expected, key);
    }
}

describe('administrator metadata', () => {
    it('renders configured metadata in HTTP HTML without executing JavaScript', async () => {
        const settings = {
            PAGE_TITLE: 'Operator title',
            SITE_DESCRIPTION: 'Visible description',
            META_DESCRIPTION: 'Search description',
            OG_TITLE: 'Preview title',
            OG_DESCRIPTION: 'Preview description',
        };
        const brand = configuredBrand(settings);
        const app = express();
        const pages = ['landing', 'login', 'newroom', 'Room', 'privacy', 'about', '404'];
        for (const page of pages) app.get('/' + page, (req, res) => res.send(render(page, brand)));
        const server = await new Promise((resolve) => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });
        try {
            for (const page of pages) {
                const html = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${server.address().port}/${page}`, (response) => {
                        let body = '';
                        response.on('data', (chunk) => {
                            body += chunk;
                        });
                        response.on('end', () => resolve(body));
                    }).on('error', reject);
                });
                const dom = new JSDOM(html);
                check(dom.window.document, settings);
                assert.equal(dom.window.document.querySelector('meta[property="og:url"]').content, brand.og.url);
                dom.window.close();
            }
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('uses independent configured fields before visible translated text', () => {
        const brand = configuredBrand(
            {
                META_DESCRIPTION: 'Configured metadata',
                OG_DESCRIPTION: 'Configured preview',
                PAGE_TITLE: 'Configured title',
                OG_TITLE: 'Configured social title',
            },
            {
                en: { SITE_DESCRIPTION: 'English visible' },
                ja: { SITE_DESCRIPTION: '表示用', SITE_NAME: '会議' },
            },
            'ja'
        );
        check(new JSDOM(render('landing', brand)).window.document, {
            PAGE_TITLE: 'Configured title',
            META_DESCRIPTION: 'Configured metadata',
            OG_TITLE: 'Configured social title',
            OG_DESCRIPTION: 'Configured preview',
        });
    });

    it('keeps selected-language metadata consistent after browser language changes', () => {
        const translations = {
            en: {
                PAGE_TITLE: 'English',
                META_DESCRIPTION: 'English metadata',
                OG_TITLE: 'English preview',
                OG_DESCRIPTION: 'English social',
            },
            fr: { META_DESCRIPTION: 'Description française' },
            'fr-CA': { OG_TITLE: 'Réunions au Canada', OG_DESCRIPTION: '' },
            ja: { PAGE_TITLE: '会議', META_DESCRIPTION: '説明', OG_TITLE: '共有タイトル', OG_DESCRIPTION: '共有説明' },
        };
        const brand = configuredBrand({ META_DESCRIPTION: 'Configured' }, translations, 'ja');
        const dom = new JSDOM(render('landing', brand), {
            runScripts: 'outside-only',
            url: 'https://meet.example.test/',
        });
        try {
            const source = read('public/js/Brand.js').replace(/\ninitialize\(\);\s*$/, '');
            dom.window.eval(source + '\nbaseSiteBrand = ' + JSON.stringify(brand) + ';');
            for (const language of ['fr-CA', 'ja', 'en-CA']) {
                dom.window.applySiteTranslations(language);
                check(dom.window.document, siteMetadata({ META_DESCRIPTION: 'Configured' }, translations, language));
            }
        } finally {
            dom.window.close();
        }
    });

    it('escapes hostile metadata as literal text and never publishes meeting context', () => {
        const value = '" ><script>alert(1)</script>&\' {{OG_URL}}';
        const brand = configuredBrand({
            PAGE_TITLE: value,
            META_DESCRIPTION: value,
            OG_TITLE: value,
            OG_DESCRIPTION: value,
        });
        const dom = new JSDOM(render('Room', brand, { meeting: { key: 'Private meeting' } }));
        try {
            check(dom.window.document, {
                PAGE_TITLE: value,
                META_DESCRIPTION: value,
                OG_TITLE: value,
                OG_DESCRIPTION: value,
            });
            assert.equal(
                dom.window.document.head.querySelector('script:not([src]):not([type="application/json"])'),
                null
            );
            for (const tag of dom.window.document.querySelectorAll('meta'))
                assert.doesNotMatch(tag.content, /Private meeting/);
            assert.equal(
                JSON.parse(dom.window.document.getElementById('authorizedMeeting').textContent).meeting.key,
                'Private meeting'
            );
        } finally {
            dom.window.close();
        }
    });

    it('falls back through title/description settings and preserves explicit empty metadata', () => {
        const fallback = siteMetadata({ PAGE_TITLE: 'Service', SITE_DESCRIPTION: 'Visible' });
        assert.deepEqual(fallback, {
            PAGE_TITLE: 'Service',
            META_DESCRIPTION: 'Visible',
            OG_TITLE: 'Service',
            OG_DESCRIPTION: 'Visible',
        });
        const empty = siteMetadata(
            { META_DESCRIPTION: 'Configured' },
            { en: { META_DESCRIPTION: '', OG_TITLE: '', OG_DESCRIPTION: '' } }
        );
        check(
            new JSDOM(
                render(
                    'landing',
                    configuredBrand({}, { en: { META_DESCRIPTION: '', OG_TITLE: '', OG_DESCRIPTION: '' } })
                )
            ).window.document,
            empty
        );
        const disabled = render('landing', {
            htmlInjection: false,
            site: { title: 'Hidden override' },
            og: { title: 'Hidden social' },
        });
        assert.doesNotMatch(disabled, /Hidden override|Hidden social|\{\{OG_/);
    });
});
