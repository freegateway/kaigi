'use strict';

const path = require('node:path');

function absoluteDirectory(value, name) {
    if (!path.isAbsolute(value) || value.includes('\0')) throw new Error(`${name} must be an absolute directory`);
    return path.resolve(value);
}

// Every deployment has an explicit instance name and independent roots.
function instancePaths(environment = process.env) {
    const instance = environment.KAIGI_INSTANCE;
    if (!instance) throw new Error('KAIGI_INSTANCE must explicitly name an instance');
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(instance)) throw new Error('Invalid KAIGI_INSTANCE name');
    if (!environment.KAIGI_CONFIG_DIR) throw new Error('Instances require KAIGI_CONFIG_DIR');
    if (!environment.KAIGI_STATE_DIR) throw new Error('Instances require KAIGI_STATE_DIR');
    const configDirectory = absoluteDirectory(environment.KAIGI_CONFIG_DIR, 'KAIGI_CONFIG_DIR');
    const stateDirectory = absoluteDirectory(environment.KAIGI_STATE_DIR, 'KAIGI_STATE_DIR');
    return Object.freeze({
        instance, configDirectory, stateDirectory,
        siteAssets: path.join(configDirectory, 'site-assets'),
        navigationCookie: `__Host-kaigi_${instance}_session`,
        recordingDirectory(configuredDirectory) {
            // Recordings stay beneath this instance's private state root.
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
