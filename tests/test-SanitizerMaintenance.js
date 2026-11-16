'use strict';

const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const createPurifier = require('dompurify');
const sanitize = require('../app/src/XSS');

describe('sanitizer dependency maintenance', () => {
    it('locks only the intended sanitizer and DOM versions', () => {
        const lock = require('../package-lock.json');
        assert.equal(lock.packages['node_modules/dompurify'].version, '3.4.18');
        assert.equal(lock.packages['node_modules/jsdom'].version, '31.0.1');
        assert(!Object.keys(lock.packages).some(name => /node_modules\/(?:canvas|@napi-rs\/canvas)/.test(name)));
    });

    it('preserves the application allowlist and custom attribute hook across repeated calls', () => {
        for (let count = 0; count < 3; count++) {
            const clean = sanitize('<div class="message"><a href="https://example.invalid/" title="javascript:secret()">link</a><img src="data:text/html,unsafe" onerror="secret()"><svg><g onclick="secret()"></g></svg><form><input name="nodeName"></form></div>');
            const dom = new JSDOM(clean);
            try {
                const doc = dom.window.document;
                assert.equal(doc.querySelector('div').className, 'message');
                assert.equal(doc.querySelector('a').getAttribute('href'), 'https://example.invalid/');
                assert.equal(doc.querySelector('a').getAttribute('title'), null);
                assert.equal(doc.querySelector('img').getAttribute('src'), null);
                assert(doc.querySelector('svg g'));
                assert.equal(doc.querySelector('form, input, [onclick], [onerror]'), null);
            } finally { dom.window.close(); }
        }
    });

    it('keeps ordinary braces literal without enabling template mode in the application', () => {
        assert.equal(sanitize('<p>{{name}} ${value} {single}</p>'), '<p>{{name}} ${value} {single}</p>');
    });

    it('handles a spoofed DOM node name safely in the dependency node-input API', () => {
        const dom = new JSDOM('');
        try {
            const purify = createPurifier(dom.window);
            const node = dom.window.document.createElement('a');
            node.href = 'data:text/html;base64,PHN2Zz48L3N2Zz4=';
            Object.defineProperty(node, 'nodeName', { get: () => 'IMG' });
            purify.sanitize(node, { IN_PLACE: true });
            assert.equal(node.getAttribute('href'), null);
        } finally { dom.window.close(); }
    });

    it('updates connectedness and tabindex without changing guide focus targets', () => {
        const dom = new JSDOM('<main></main>');
        try {
            const doc = dom.window.document, heading = doc.createElement('h2');
            heading.tabIndex = -1;
            assert.equal(heading.isConnected, false);
            doc.querySelector('main').append(heading);
            assert.equal(heading.isConnected, true);
            assert.equal(heading.tabIndex, -1);
            heading.setAttribute('tabindex', 'invalid');
            assert.equal(heading.tabIndex, -1);
            heading.remove();
            assert.equal(heading.isConnected, false);
        } finally { dom.window.close(); }
    });
});
