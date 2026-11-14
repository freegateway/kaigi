'use strict';

const path = require('node:path');

function absoluteDirectory(value, name) {
    if (!path.isAbsolute(value) || value.includes('\0')) throw new Error(`${name} must be an absolute directory`);
    return path.resolve(value);
}

// Resolve once at startup. Configuration and credentials must never fall back
// to the default installation when a named instance is selected.
function instancePaths(environment = process.env, sourceDirectory = __dirname) {
    const instance = environment.KAIGI_INSTANCE || 'default';
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(instance)) throw new Error('Invalid KAIGI_INSTANCE name');
    const named = instance !== 'default';
    if (named && !environment.KAIGI_CONFIG_DIR) throw new Error('Named instances require KAIGI_CONFIG_DIR');
    if (named && !environment.KAIGI_STATE_DIR) throw new Error('Named instances require KAIGI_STATE_DIR');
    const configDirectory = absoluteDirectory(environment.KAIGI_CONFIG_DIR || '/usr/local/etc/kaigi', 'KAIGI_CONFIG_DIR');
    const stateDirectory = environment.KAIGI_STATE_DIR
        ? absoluteDirectory(environment.KAIGI_STATE_DIR, 'KAIGI_STATE_DIR') : null;
    return Object.freeze({
        instance, named, configDirectory, stateDirectory,
        siteAssets: path.join(configDirectory, 'site-assets'),
        navigationCookie: named ? `__Host-kaigi_${instance}_session` : '__Host-mirotalk_session',
        recordingDirectory(configuredDirectory) {
            // Keep historical relative recording paths for the default instance.
            // Named instances keep all recording paths beneath their state root.
            if (!stateDirectory) return path.resolve(sourceDirectory, configuredDirectory || '../rec');
            const directory = path.resolve(stateDirectory, configuredDirectory || 'recordings');
            const relative = path.relative(stateDirectory, directory);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw new Error('RECORDING_DIR must remain inside KAIGI_STATE_DIR');
            }
            return directory;
        },
    });
}

module.exports = { instancePaths };
