'use strict';

// Match browser locale preferences against administrator-enabled languages.
function matchLanguage(preferences, available) {
    for (const raw of preferences) {
        const tag = String(raw).trim().replace(/_/g, '-').toLowerCase();
        const exact = available.find((code) => code.toLowerCase() === tag);
        if (exact) return exact;
        const base = tag.split('-')[0];
        const match =
            available.find((code) => code.toLowerCase() === base) ||
            available.find((code) => code.toLowerCase().split('-')[0] === base);
        if (match) return match;
    }
    return 'en';
}

function requestLanguage(req, available) {
    const preferences = String(req.headers?.['accept-language'] || '')
        .split(',')
        .map((item, index) => {
            const [tag, parameter] = item.trim().split(';');
            const quality = parameter ? Number(parameter.trim().replace(/^q=/, '')) : 1;
            return { tag, quality, index };
        })
        .filter(({ tag, quality }) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag) && quality > 0 && quality <= 1)
        .sort((a, b) => b.quality - a.quality || a.index - b.index)
        .map(({ tag }) => tag);
    return matchLanguage(preferences, available);
}

module.exports = { matchLanguage, requestLanguage };
