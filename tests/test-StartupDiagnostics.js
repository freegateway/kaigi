'use strict';
const assert = require('node:assert/strict');
const { diagnose, formatDiagnostic } = require('../app/src/StartupDiagnostics');

describe('safe startup diagnostics', () => {
    const report = (message, extra = {}, stage = 'configuration', resource = 'kaigi.conf') =>
        formatDiagnostic(diagnose(Object.assign(Error(message), extra), stage, resource));
    it('reports fixed reasons, bounded setting names and line numbers', () => {
        assert.match(report('Invalid kaigi.conf entry at line 17'), /kaigi.conf, line 17.*expected SETTING=value/);
        assert.match(report('Duplicate configuration setting: WEB_URL'), /WEB_URL.*duplicate setting/);
        assert.match(report('Named instances require an explicit valid SERVER_LISTEN_PORT'), /WEB_LISTEN_PORT.*1 to 65535/);
        assert.match(report('MEDIA_MAX_PORT must not be below MEDIA_MIN_PORT'), /MEDIA_MAX_PORT must not be below MEDIA_MIN_PORT/);
        assert.match(report('HTTP_HEADERS_TIMEOUT must be 1..3600 seconds'), /HTTP_HEADERS_TIMEOUT.*3600/);
    });
    it('identifies LDAP parsing, missing credentials and TLS resources without their contents', () => {
        assert.match(report('Invalid kaigi.conf entry at line 2', { configResource: 'ldap/ldap.conf' }), /ldap\/ldap.conf, line 2/);
        assert.match(report('secret', { code: 'ENOENT' }, 'credentials', 'users'), /users.*file is missing/);
        assert.match(report('private-key-bytes', { code: 'EACCES' }, 'tls', 'TLS private key'), /TLS private key.*access denied/);
        assert.match(report('openssl secret', {}, 'tls', 'TLS certificate/key pair'), /invalid TLS/);
    });
    it('never forwards arbitrary values, exception messages, paths, stacks or injected lines', () => {
        for (const message of ['password=secret\nforged', 'Invalid kaigi.conf variable name at line 9: password=secret\nforged',
            'Unsupported UI_LANGUAGE code: password=secret\nforged', 'Site translation password=secret\nforged',
            'WEB_LISTEN_HOST "password=secret\nforged"', 'Duplicate configuration setting: PASSWORD=secret']) {
            const text = report(message, { stack: 'private stack', path: '/private/secret' });
            assert.ok(!/secret|forged|private|\n/.test(text), text);
        }
        assert.equal(formatDiagnostic({ stage: 'configuration', resource: 'password=secret', reason: 'missing' }), null);
        assert.equal(formatDiagnostic({ stage: 'configuration', resource: 'kaigi.conf', reason: '__proto__' }), null);
    });
});
