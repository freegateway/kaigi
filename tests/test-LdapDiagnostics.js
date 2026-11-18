'use strict';
const assert = require('node:assert/strict');
const { LdapError, ldapConfig } = require('../app/src/LdapAuth.cjs');
const { diagnostic, format } = require('../app/src/LdapDiagnostics');
const { diagnose, formatDiagnostic } = require('../app/src/StartupDiagnostics');
describe('actionable LDAP diagnostics', () => {
    it('preserves typed bind-secret metadata across the inspector JSON boundary', () => {
        const error = new LdapError('UNSAFE_SECRET_FILE', 'private bytes');
        error.ldapDiagnostic = diagnostic(error.code, '', { file: '/etc/kaigi/freegateway/ldap/bind-secret', uid: 1001, mode: 0o600, operation: 'bind-secret' });
        const output = formatDiagnostic(JSON.parse(JSON.stringify(diagnose(error, 'configuration', 'kaigi.conf'))));
        assert.match(output, /bind-secret.*root-owned.*0600.*file.*freegateway.*owner UID 1001.*mode 0600/);
        assert.doesNotMatch(output, /private bytes|invalid LDAP policy/);
    });
    it('identifies incorrect settings and expected values without leaking configured values', () => {
        try { ldapConfig({ LDAP_ENABLED: 'password-secret' }, '/etc/kaigi/ldap/group-meetings.json'); assert.fail(); }
        catch (e) { const output = format(e.ldapDiagnostic); assert.match(output, /LDAP_ENABLED.*exactly true or false/); assert.doesNotMatch(output, /password-secret/); }
    });
    it('distinguishes TLS, bind, ACL, search, group and policy failures', () => {
        assert.match(format(diagnostic('DIRECTORY_UNAVAILABLE', '', { operation: 'tls', cause: 'ERR_TLS_CERT_ALTNAME_INVALID' })), /hostname mismatch/);
        assert.match(format(diagnostic('DIRECTORY_UNAVAILABLE', '', { operation: 'search-bind', cause: '49' })), /bind credentials/);
        assert.match(format(diagnostic('DIRECTORY_UNAVAILABLE', '', { operation: 'group-search', cause: '50' })), /ACL/);
        assert.match(format(diagnostic('DIRECTORY_UNAVAILABLE', '', { operation: 'user-search', cause: '32' })), /base does not exist/);
        for (const code of ['SECRET_MISSING', 'SECRET_ACCESS', 'SECRET_SYMLINK', 'SECRET_CONTENT', 'INVALID_POLICY', 'NO_MEETING_GRANTS', 'PASSWORD_POLICY_REJECTED', 'GROUP_LIMIT_EXCEEDED']) assert.ok(format(diagnostic(code)));
    });
    it('does not forward arbitrary messages, causes, metadata or injected newlines', () => {
        const d = diagnostic('DIRECTORY_UNAVAILABLE', 'password=private', { cause: 'secret\nforged', operation: 'secret', file: '/file\nforged', uid: 'private', mode: 'private', rule: 'private' });
        const result = format(d); assert.doesNotMatch(result, /private|\n|secret/); assert.match(result, /\\nforged/);
    });
});
