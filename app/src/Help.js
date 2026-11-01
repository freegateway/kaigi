'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../../package.json');
const strings = require('./templates/HelpStrings.json');
const template = fs.readFileSync(path.join(__dirname, 'templates/Help.html'), 'utf8');
const languages = ['en', 'en-CA', 'fr-CA', 'ja'];
const dictionaries = Object.fromEntries(languages.map((code) => [code, require(`../../public/lang/${code}.json`)]));
const policy =
    "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

function escape(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
}

function localLogo(value) {
    try {
        const url = new URL(value || '/images/logo.svg', 'https://kaigi.invalid/help');
        if (
            url.origin === 'https://kaigi.invalid' &&
            !url.search &&
            !url.hash &&
            ['/images/', '/site-assets/'].some((prefix) => url.pathname.startsWith(prefix))
        )
            return url.pathname;
    } catch {}
    return '/images/logo.svg';
}

function renderHelp(input = {}, requested) {
    const brand = input.htmlInjection === false ? {} : input;
    const language = languages.includes(requested)
        ? requested
        : languages.includes(brand.app?.language)
          ? brand.app.language
          : 'en';
    const copy = strings[language] || strings.en;
    const dictionary = dictionaries[language];
    const ui = (key) => {
        for (const section of ['labels', 'buttons', 'dialogs', 'tooltips']) {
            if (typeof dictionary[section]?.[key] === 'string') return dictionary[section][key];
        }
        return key;
    };
    // Match the application's English -> base language -> exact language overlay.
    // Only public text fields are projected, never the complete brand/config object.
    const translations = brand.siteTranslations || {};
    const values = { ...translations.en, ...translations[language.split('-')[0]], ...translations[language] };
    const configured = (name, fallback) => (Object.hasOwn(values, name) ? String(values[name]) : ui(String(fallback)));
    const data = {
        ...copy,
        LANGUAGE: language,
        VERSION: version,
        SITE_NAME: String(values.SITE_NAME ?? (brand.site?.name || brand.app?.name || 'Kaigi')),
        SITE_DESCRIPTION: String(values.SITE_DESCRIPTION ?? (brand.site?.description || '')),
        SITE_COPYRIGHT: String(values.SITE_COPYRIGHT ?? (brand.site?.copyright || '')),
        LOGO: localLogo(brand.site?.logo),
        LOGIN_HEADING: configured('LOGIN_HEADING', brand.login?.heading || 'Welcome back'),
        LOGIN_INSTRUCTIONS: configured(
            'LOGIN_INSTRUCTIONS',
            brand.login?.description || 'Enter your credentials to continue.'
        ),
        LOGIN_LABEL: configured('LOGIN_BUTTON_LABEL', brand.login?.buttonLabel || 'Login'),
        CHOOSE_HEADING: configured('NEW_ROOM_TITLE', brand.site?.newRoomTitle || 'Choose a meeting'),
        CHOOSE_INSTRUCTIONS: configured(
            'NEW_ROOM_DESCRIPTION',
            brand.site?.newRoomDescription || 'Sign in and choose a meeting you are authorized to join.'
        ),
        JOIN_LABEL: configured('JOIN_BUTTON_LABEL', brand.app?.joinButtonLabel || 'Join meeting'),
        USERNAME_LABEL: ui('Username'),
        PASSWORD_LABEL: ui('Password'),
        LOGOUT_LABEL: ui('Logout'),
    };
    return template.replace(/{{([A-Z_]+)}}/g, (_match, key) => escape(data[key]));
}

function helpHandler(brand) {
    return (req, res) => {
        const current = res.getHeader('Content-Security-Policy');
        res.setHeader('Content-Security-Policy', [
            ...(Array.isArray(current) ? current : current ? [current] : []),
            policy,
        ]);
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=(), geolocation=()');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.type('html').send(renderHelp(brand, req.query.lang));
    };
}

module.exports = helpHandler;
module.exports.renderHelp = renderHelp;
