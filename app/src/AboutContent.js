'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../../package.json');
const template = fs.readFileSync(path.join(__dirname, 'templates/About.html'), 'utf8');

function renderAbout(sourceCodeUrl = 'https://github.com/freegateway/kaigi') {
    const escape = (value) =>
        String(value).replace(
            /[&<>"']/g,
            (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
        );
    let source = String(sourceCodeUrl || 'https://github.com/freegateway/kaigi');
    try {
        const url = new URL(source, 'https://kaigi.invalid');
        if (!['http:', 'https:'].includes(url.protocol)) source = 'https://github.com/freegateway/kaigi';
    } catch {
        source = 'https://github.com/freegateway/kaigi';
    }
    return template
        .replaceAll('{{KAIGI_VERSION}}', () => escape(version))
        .replaceAll('{{SOURCE_URL}}', () => escape(source));
}

module.exports = { renderAbout };
