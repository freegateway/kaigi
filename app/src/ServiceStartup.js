'use strict';
require('./StartupEnvironment');
const { execFileSync } = require('node:child_process');

function dropPrivileges(user, group) {
    if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(user || '') || !/^[a-z_][a-z0-9_-]*[$]?$/.test(group || '')) throw Error('Invalid service identity');
    const options = { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'] };
    const uid = Number(execFileSync('/usr/bin/id', ['-u', user], options).trim());
    const gid = Number(execFileSync('/usr/bin/getent', ['group', group], options).trim().split(':')[2]);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) throw Error('Service identity must be unprivileged');
    process.initgroups(user, gid);
    process.setgid(gid);
    process.setuid(uid);
    if (process.getuid() !== uid || process.getgid() !== gid) throw Error('Privilege drop failed');
}

function start() {
    if (process.getuid?.() !== 0) throw Error('Service bootstrap requires root');
    const config = require('./config');
    if (config.security?.ldap?.enabled) require('./LdapAuth.cjs').initializeBindSecret(config.security.ldap);
    dropPrivileges(process.env.KAIGI_RUN_USER, process.env.KAIGI_RUN_GROUP);
    delete process.env.KAIGI_RUN_USER;
    delete process.env.KAIGI_RUN_GROUP;
    // Same process and module cache: secrets never pass through argv or files.
    require('./Server');
}

if (require.main === module) {
    try { start(); }
    catch (error) {
        const { diagnose, formatDiagnostic } = require('./StartupDiagnostics');
        console.error(`kaigi: ${formatDiagnostic(diagnose(error, 'configuration', 'kaigi.conf')) || 'privileged service initialization failed'}`);
        process.exitCode = 1;
    }
}
module.exports = { dropPrivileges };
