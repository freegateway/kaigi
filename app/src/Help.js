'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../../package.json');
const strings = require('./templates/HelpStrings.json');
const topics = require('./templates/HelpTopics.json');
const { requestLanguage } = require('./Locale');
const crypto = require('node:crypto');
const scriptHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '../../public/js/Help.js')))
    .digest('base64');
const template = fs.readFileSync(path.join(__dirname, 'templates/Help.html'), 'utf8');
const languages = ['en', 'en-CA', 'fr-CA', 'ja'];
const dictionaries = Object.fromEntries(languages.map((code) => [code, require(`../../public/lang/${code}.json`)]));
const policy = `default-src 'none'; script-src 'sha256-${scriptHash}'; script-src-attr 'none'; connect-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'self'; base-uri 'none'`;
const interfaceLanguages = fs
    .readdirSync(path.join(__dirname, '../../public/lang'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5));

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
    const permitted = Array.isArray(input.app?.languages)
        ? [...new Set(input.app.languages.filter((code) => interfaceLanguages.includes(code)))]
        : interfaceLanguages;
    const available = permitted.length ? permitted : interfaceLanguages;
    const selected = requested === 'en' || available.includes(requested)
        ? requested
        : available.includes(input.app?.language)
          ? input.app.language
          : available.includes('en')
            ? 'en'
            : available[0];
    const language = languages.includes(selected) ? selected : 'en';
    const copy = strings[language] || strings.en;
    const dictionary = dictionaries[language];
    const ui = (key) => {
        for (const section of ['tooltips', 'buttons', 'labels', 'dialogs', 'toasts']) {
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
        LOGIN_STEP_A: values.HELP_LOGIN_INSTRUCTIONS ?? copy.LOGIN_STEP_A,
        LANGUAGE: language,
        INTERFACE_LANGUAGE: selected,
        AVAILABLE_LANGUAGES: JSON.stringify(available),
        RETURN_TO_LOGIN: dictionary.about?.returnToLogin || 'Return to login',
        VERSION: version,
        SECURITY_LABEL: language === 'ja' ? 'セキュリティとプライバシー' : language === 'fr-CA' ? 'Sécurité et vie privée' : 'Security and privacy',
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
        PREJOIN_LABEL: ui('Join meeting'),
        LEAVE_LABEL: ui('Leave meeting'),
        AUDIO_ON: ui('Start the audio'),
        AUDIO_OFF: ui('Stop the audio'),
        VIDEO_ON: ui('Start the video'),
        VIDEO_OFF: ui('Stop the video'),
        SCREEN_ON: ui('Start screen share'),
        SCREEN_OFF: ui('Stop screen share'),
        CHAT_LABEL: ui('Chat'),
        SETTINGS_LABEL: ui('Toggle the settings'),
        WHITEBOARD_LABEL: ui('Whiteboard'),
        PIN_LABEL: ui('Pin video'),
        UNPIN_LABEL: ui('Unpin video'),
        VIEW_LABEL: ui('Change participant view'),
        GRID_LABEL: ui('Grid'),
        SPEAKER_LABEL: ui('Speaker left'),
        PIP_LABEL: ui('Picture in Picture'),
        HIDE_SELF_LABEL: ui('Hide Me'),
        SELF_LABEL: language === 'ja' ? '自分' : language === 'fr-CA' ? 'Vous' : 'You',
        OTHER_LABEL:
            language === 'ja' ? 'ほかの参加者' : language === 'fr-CA' ? 'Autre participant' : 'Other participant',
        CONTENTS: topics[language]?.contents || topics.en.contents,
    };
    const expand = (text) => String(text).replace(/\[\[([A-Z_]+)\]\]/g, (_match, key) => String(data[key] ?? ''));
    const sections = topics[language]?.sections || topics.en.sections;
    const controls = {
        'help-video-layout': [
            ['thumbtack', 'PIN_LABEL'],
            ['table-columns', 'VIEW_LABEL'],
        ],
        'help-media': [
            ['microphone-slash', 'AUDIO_ON'],
            ['microphone', 'AUDIO_OFF'],
            ['video-slash', 'VIDEO_ON'],
            ['video', 'VIDEO_OFF'],
            ['cogs', 'SETTINGS_LABEL'],
        ],
        'help-screen': [
            ['desktop', 'SCREEN_ON'],
            ['stop-circle', 'SCREEN_OFF'],
        ],
        'help-chat': [['comment', 'CHAT_LABEL']],
        'help-whiteboard': [['chalkboard', 'WHITEBOARD_LABEL']],
        'help-leave': [
            ['sign-out-alt', 'LEAVE_LABEL'],
            ['power-off', 'LOGOUT_LABEL'],
        ],
    };
    const illustrate = (section) => {
        const items = controls[section.id];
        if (!items) return '';
        const alt = `${section.title}: ${items.map(([, key]) => data[key]).join('; ')}`;
        const layouts =
            section.id === 'help-video-layout'
                ? `<div class="help-layout-examples"><div><strong>${escape(data.GRID_LABEL)}</strong><div class="help-mini-tiles"><span>${escape(data.OTHER_LABEL)}</span><span>${escape(data.SELF_LABEL)}</span></div></div><div><strong>${escape(data.PIN_LABEL)}</strong><div class="help-mini-tiles help-mini-pinned"><span>${escape(data.OTHER_LABEL)}</span><span>${escape(data.SELF_LABEL)}</span></div></div></div>`
                : '';
        return `<figure class="help-control-reference"><div role="img" aria-label="${escape(alt)}"><div class="help-icon-list" inert aria-hidden="true">${items.map(([icon, key]) => `<div><i class="fas fa-${icon}"></i><span>${escape(data[key])}</span></div>`).join('')}${layouts}</div></div><figcaption>${escape(copy.ILLUSTRATION)}</figcaption></figure>`;
    };
    const nav = [
        ['help-login-title', expand(copy.LOGIN_TITLE).replace(/^\d+\.\s*/, '')],
        ['help-choice-title', expand(copy.CHOICE_TITLE).replace(/^\d+\.\s*/, '')],
        ...sections.map((section) => [section.id, section.title]),
    ];
    const html = {
        HELP_NAV: nav.map(([id, title]) => `<li><a href="#${id}">${escape(title)}</a></li>`).join(''),
        HELP_TOPICS: sections
            .map(
                (section) =>
                    `<section class="help-text-topic" aria-labelledby="${section.id}"><h2 id="${section.id}" tabindex="-1">${escape(section.title)}</h2>${illustrate(section)}${section.paragraphs.map((text) => `<p>${escape(expand(text))}</p>`).join('')}</section>`
            )
            .join(''),
        SCRIPT_INTEGRITY: `sha256-${scriptHash}`,
        LANGUAGE_NOTE: language === selected ? '' : escape(copy.HELP_LANGUAGE_FALLBACK),
    };
    // Expand instruction placeholders once, then escape. Configured values stay literal.
    return template.replace(/{{([A-Z_]+)}}/g, (_match, key) =>
        Object.hasOwn(html, key)
            ? html[key]
            : escape(
                  key === 'LOGIN_STEP_A' ? data.LOGIN_STEP_A : Object.hasOwn(copy, key) ? expand(copy[key]) : data[key]
              )
    );
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
        const allowed = brand.app?.languages || interfaceLanguages;
        res.type('html').send(renderHelp(brand, req.query.lang || requestLanguage(req, allowed)));
    };
}

module.exports = helpHandler;
module.exports.renderHelp = renderHelp;
