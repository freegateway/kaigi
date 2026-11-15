'use strict';

// Service launches opt into a clean environment before configuration is loaded.
// Interactive npm/developer launches retain their existing environment interface.
function cleanEnvironment(environment) {
    const allowed = new Set(['PATH', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL', 'LC_CTYPE',
        'KAIGI_INSTANCE', 'KAIGI_CONFIG_DIR', 'KAIGI_STATE_DIR', 'KAIGI_READY_FILE',
        'KAIGI_STARTUP_NONCE', 'KAIGI_SERVICE', 'JWT_SECRET', 'HOST_USERS', 'MEDIASOUP_WORKER_BIN']);
    return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key)));
}
if (process.env.KAIGI_SERVICE === '1') {
    const clean = cleanEnvironment(process.env);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, clean);
}
module.exports = { cleanEnvironment };
