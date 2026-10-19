'use strict';
const fs = require('node:fs');
const path = require('node:path');
const meetingKeyRules = '1–128 printable Unicode characters; control, format, surrogate, unassigned, line-separator and paragraph-separator characters are forbidden';
function isMeetingKey(value) {
    return typeof value === 'string' && [...value].length >= 1 && [...value].length <= 128 && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);
}
function readOptional(filename) {
    let fd;
    try {
        fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > 262144 || (stat.mode & 0o022)) throw new Error('must be a regular non-symlink file, no larger than 256 KiB, and not writable by group or others');
        const bytes = fs.readFileSync(fd);
        if (bytes.length > 262144) throw new Error('file exceeds 256 KiB');
        return new (require('node:util').TextDecoder)('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error(`Cannot read meeting configuration ${JSON.stringify(filename)} (regular non-symlink UTF-8 file required): ${error.message}`);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function parseJSON(source, filename) {
    let value;
    try { value = JSON.parse(source); } catch { throw new Error(`${filename}: invalid JSON`); }
    // Reject duplicate object keys before they can replace an authorization grant or restriction.
    const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
    let index = 0;
    function visit() {
        const token = tokens[index++];
        if (token === '{') {
            const keys = new Set();
            if (tokens[index] === '}') { index++; return; }
            do {
                const key = JSON.parse(tokens[index++]);
                if (keys.has(key)) throw new Error(`${filename}: duplicate JSON key=${JSON.stringify(key)}`);
                keys.add(key); index++; visit();
            } while (tokens[index++] === ',');
        } else if (token === '[') {
            if (tokens[index] === ']') { index++; return; }
            do { visit(); } while (tokens[index++] === ',');
        }
    }
    visit();
    return value;
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseProperties(source, filename = 'meeting-properties.json') {
    const restrictions = Object.create(null), translations = Object.create(null);
    if (source === null) return { restrictions, translations };
    const data = parseJSON(source, filename);
    if (!isObject(data)) throw new Error(`${filename}: expected an object keyed by meeting key`);
    for (const [key, properties] of Object.entries(data)) {
        const reject = reason => { throw new Error(`${filename}: meeting key=${JSON.stringify(key)}: ${reason}`); };
        if (!isMeetingKey(key)) reject(`invalid key; expected ${meetingKeyRules}`);
        if (!isObject(properties) || Object.keys(properties).some(name => !['names', 'restrictions'].includes(name))) reject('expected an object containing only names and restrictions');
        const names = Object.hasOwn(properties, 'names') ? properties.names : {}, codes = Object.hasOwn(properties, 'restrictions') ? properties.restrictions : [];
        if (!isObject(names)) reject('names must be a language-to-label object');
        for (const [language, label] of Object.entries(names)) {
            if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) || !isMeetingKey(label)) reject(`invalid language or display label for language=${JSON.stringify(language)}`);
        }
        if (!Array.isArray(codes) || codes.some(code => code !== 'RP') || new Set(codes).size !== codes.length) reject(`restrictions must be an array of unique supported codes (RP); received ${JSON.stringify(codes)}`);
        translations[key] = names;
        restrictions[key] = codes;
    }
    return { restrictions, translations };
}
function loadMeetingSettings(directory) {
    const filename = path.join(directory, 'meeting-properties.json');
    return parseProperties(readOptional(filename), filename);
}
module.exports = { isMeetingKey, meetingKeyRules, readOptional, parseJSON, isObject, parseProperties, loadMeetingSettings };
