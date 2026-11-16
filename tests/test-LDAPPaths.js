'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { ldapConfig } = require('../app/src/LdapAuth.cjs');

describe('instance-relative LDAP file paths', () => {
    const values = {
        LDAP_ENABLED: 'true', LDAP_TRANSPORT: 'ldap-starttls', LDAP_URL: 'ldap://127.0.0.1:389',
        LDAP_BIND_DN: 'cn=search,dc=example', LDAP_BIND_PASSWORD_FILE: 'bind-secret',
        LDAP_TLS_CA_FILE: 'certs/ca.pem', LDAP_USER_BASE: 'dc=example', LDAP_USER_SCOPE: 'sub',
        LDAP_USER_FILTER: '(uid={username})', LDAP_USERNAME_ATTRIBUTE: 'uid', LDAP_DISPLAY_NAME_ATTRIBUTE: 'cn',
        LDAP_GROUPS_ENABLED: 'false', LDAP_MEETING_MODE: 'direct',
    };
    it('resolves secret and CA paths independently for each instance, never against cwd', () => {
        for (const name of ['staff', 'public']) {
            const directory = `/usr/local/etc/kaigi/${name}/ldap`;
            const config = ldapConfig(values, path.join(directory, 'group-meetings.json'));
            assert.equal(config.bindPasswordFile, path.join(directory, 'bind-secret'));
            assert.equal(config.caFile, path.join(directory, 'certs/ca.pem'));
        }
    });
    it('preserves explicit absolute paths and resolves dot segments normally', () => {
        const config = ldapConfig({ ...values, LDAP_BIND_PASSWORD_FILE: '/private/shared-secret', LDAP_TLS_CA_FILE: '/etc/ssl/cert.pem' }, '/config/staff/ldap/group-meetings.json');
        assert.equal(config.bindPasswordFile, '/private/shared-secret');
        assert.equal(config.caFile, '/etc/ssl/cert.pem');
        assert.equal(ldapConfig({ ...values, LDAP_BIND_PASSWORD_FILE: '../bind-secret' }, '/config/staff/ldap/group-meetings.json').bindPasswordFile, '/config/staff/bind-secret');
    });
    it('loads relative LDAP paths through each named instance configuration in a clean subprocess', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-ldap-paths-'));
        try {
            for (const name of ['staff', 'public']) {
                const directory = path.join(root, name);
                fs.mkdirSync(path.join(directory, 'ldap'), { recursive: true });
                fs.writeFileSync(path.join(directory, 'kaigi.conf'), 'LDAP_ENABLED=true\nWEB_LISTEN_PORT=7443\nWEB_URL=https://localhost:7443\nMEDIA_MIN_PORT=40000\nMEDIA_MAX_PORT=40100\n');
                const settings = { ...values };
                delete settings.LDAP_ENABLED;
                fs.writeFileSync(path.join(directory, 'ldap/ldap.conf'), Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n'));
                const configPath = path.resolve(__dirname, '../app/src/config.js');
                const output = execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(configPath)}).security.ldap))`], {
                    cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH, KAIGI_INSTANCE: name,
                        KAIGI_CONFIG_DIR: directory, KAIGI_STATE_DIR: path.join(root, 'state', name),
                        SFU_ANNOUNCED_IP: '127.0.0.1', JWT_SECRET: 'test-only-012345678901234567890123456789' },
                });
                const config = JSON.parse(output);
                assert.equal(config.bindPasswordFile, path.join(directory, 'ldap/bind-secret'));
                assert.equal(config.caFile, path.join(directory, 'ldap/certs/ca.pem'));
                assert.equal(config.groupMeetingsFile, path.join(directory, 'ldap/group-meetings.json'));
            }
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('supports plain LDAP without a CA and still requires explicit valid paths', () => {
        const config = ldapConfig({ ...values, LDAP_TRANSPORT: 'ldap-plain' }, '/config/staff/ldap/group-meetings.json');
        assert.equal(config.bindPasswordFile, '/config/staff/ldap/bind-secret');
        assert.equal(config.caFile, undefined);
        for (const value of ['', 'bad\0path']) assert.throws(() => ldapConfig({ ...values, LDAP_BIND_PASSWORD_FILE: value }, '/config/staff/ldap/group-meetings.json'));
        assert.throws(() => ldapConfig(values, 'relative/group-meetings.json'), /absolute configuration path/);
    });
});
