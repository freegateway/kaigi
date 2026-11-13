'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestLanguage } = require('./Locale');
const { version } = require('../../package.json');
const guideLanguages = ['en', 'en-CA', 'ja', 'fr-CA'];
const interfaceLanguages = fs
    .readdirSync(path.join(__dirname, '../../public/lang'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5));
const escape = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
const scriptHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '../../public/js/Help.js')))
    .digest('base64');

// Deliberately restricted Markdown for maintained prose: no raw HTML, images or scripts.
function prose(text) {
    const inline = (value) =>
        escape(value)
            .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return text
        .trim()
        .split(/\n\n+/)
        .map((block) => {
            if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
            if (block.startsWith('- '))
                return `<ul>${block
                    .split('\n')
                    .map((line) => `<li>${inline(line.slice(2))}</li>`)
                    .join('')}</ul>`;
            return `<p>${inline(block)}</p>`;
        })
        .join('\n');
}

function renderSecurity(input = {}, requested = 'en') {
    const brand = input.htmlInjection === false ? {} : input;
    const permitted = Array.isArray(input.app?.languages)
        ? input.app.languages.filter((code) => interfaceLanguages.includes(code))
        : interfaceLanguages;
    const available = permitted.length ? permitted : interfaceLanguages;
    const selected = available.includes(requested) ? requested : 'en';
    const language = guideLanguages.includes(selected) ? selected : 'en';
    const copy = {
        en: ['Security and privacy', 'Back', 'Help', 'About', 'Print / Save as PDF'],
        ja: ['セキュリティとプライバシー', '戻る', 'ヘルプ', 'Kaigi について', '印刷 / PDF として保存'],
        'fr-CA': ['Sécurité et vie privée', 'Retour', 'Aide', 'À propos', 'Imprimer / Enregistrer en PDF'],
    }[language === 'en-CA' ? 'en' : language];
    const translations = brand.siteTranslations || {};
    const values = { ...translations.en, ...translations[language.split('-')[0]], ...translations[language] };
    const name = escape(values.SITE_NAME ?? brand.site?.name ?? brand.app?.name ?? 'Kaigi');
    let logo = '/images/logo.svg';
    try {
        const url = new URL(brand.site?.logo || logo, 'https://kaigi.invalid');
        if (
            url.origin === 'https://kaigi.invalid' &&
            !url.search &&
            !url.hash &&
            ['/images/', '/site-assets/'].some((prefix) => url.pathname.startsWith(prefix))
        )
            logo = url.pathname;
    } catch {}
    const text = fs.readFileSync(
        path.join(__dirname, `templates/security.${language === 'en-CA' ? 'en' : language}.md`),
        'utf8'
    );
    return `<!doctype html>
<html lang="${language}" data-public-path="/security" data-help-language="${escape(selected)}" data-help-languages="${escape(JSON.stringify(available))}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${copy[0]} - ${name}</title>
<link rel="stylesheet" href="/css/landing.css"><link rel="stylesheet" href="/css/login.css">
<link rel="stylesheet" href="/css/help.css"><link rel="stylesheet" href="/css/security.css">
<link rel="stylesheet" href="/site-assets/site.css">
<script defer src="/js/Help.js" integrity="sha256-${scriptHash}"></script></head>
<body class="help-page security-page"><header class="help-header">
<button id="helpPrint" type="button" hidden>${copy[4]}</button>
<a href="/" class="help-identity"><img src="${escape(logo)}" alt=""><span>${name}</span></a></header>
<main class="security-main"><h1>${copy[0]}</h1>${prose(text)}
<p><a class="button button-primary" href="/login" id="publicBack">${copy[1]}</a></p></main>
<footer class="help-footer"><a href="/help">${copy[2]}</a><a href="/about">${copy[3]}</a><span>Kaigi ${escape(version)}</span><span>${escape(values.SITE_COPYRIGHT ?? brand.site?.copyright ?? '')}</span></footer></body></html>`;
}

module.exports = (brand) => (req, res) => {
    const current = res.getHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', [
        ...(Array.isArray(current) ? current : current ? [current] : []),
        `default-src 'none'; script-src 'sha256-${scriptHash}'; script-src-attr 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'`,
    ]);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const available = (brand.app?.languages || interfaceLanguages).filter((code) => interfaceLanguages.includes(code));
    res.type('html').send(renderSecurity(brand, req.query.lang || requestLanguage(req, available)));
};
module.exports.renderSecurity = renderSecurity;
