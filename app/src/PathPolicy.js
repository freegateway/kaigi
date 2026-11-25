'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfigFile } = require('./ConfigFile');

function pathError(filename, reason) {
    const error = Error(reason === 'symlink' ? 'Symlink in instance path' : 'Invalid instance path');
    error.instancePath = { path: filename, reason };
    return error;
}

function noSymlinks(filename, configurable = false) {
    const absolute = path.resolve(filename);
    let current = path.parse(absolute).root;
    for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                if (configurable) throw pathError(current, 'symlink');
                throw Error('Symlink in instance path');
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}

// Resolve existing ancestors too: a state/recording directory may not exist yet.
// lstat distinguishes a missing component from a dangling link, which must fail.
function resolvePath(filename, allowSymlinks = true, allowMissing = true) {
    if (!allowSymlinks) noSymlinks(filename, true);
    let current = path.resolve(filename);
    const missing = [];
    for (;;) {
        try { fs.lstatSync(current); }
        catch (error) {
            if (error.code !== 'ENOENT' || !allowMissing) throw pathError(current, 'unresolved');
            missing.unshift(path.basename(current));
            current = path.dirname(current);
            continue;
        }
        let resolved;
        try { resolved = fs.realpathSync(current); }
        catch { throw pathError(current, 'unresolved'); }
        if (missing.length && !fs.statSync(resolved).isDirectory()) throw pathError(current, 'directory');
        return path.join(resolved, ...missing);
    }
}

function validateDirectory(filename) {
    let current = filename;
    for (;;) {
        let stat;
        try { stat = fs.statSync(current); }
        catch (error) {
            if (error.code !== 'ENOENT') throw pathError(current, 'unresolved');
            current = path.dirname(current);
            continue;
        }
        if (!stat.isDirectory()) throw pathError(current, 'directory');
        // Root-owned sticky system parents such as /tmp are not writable aliases.
        if ((stat.mode & 0o022) && !(stat.uid === 0 && (stat.mode & 0o1000))) throw pathError(current, 'unsafe');
        if (path.dirname(current) === current) return;
        current = path.dirname(current);
    }
}

function loadInstanceConfiguration(environment = process.env) {
    const { instancePaths } = require('./InstancePaths');
    const original = instancePaths(environment);
    const filename = path.join(original.configDirectory, 'kaigi.conf');
    // Read declarative settings before enforcing the directory-link policy.
    // The configuration file itself must remain a regular protected file.
    let stat;
    try { stat = fs.lstatSync(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (!stat.isFile() || (stat.mode & 0o022))) throw pathError(filename, 'unsafe');
    const values = loadConfigFile(filename, true);
    if (values.ALLOW_SYMLINKS !== undefined && !['true', 'false'].includes(values.ALLOW_SYMLINKS)) {
        const error = Error('ALLOW_SYMLINKS must be true or false');
        error.configResource = 'kaigi.conf';
        throw error;
    }
    const allowSymlinks = values.ALLOW_SYMLINKS === 'true';
    const configDirectory = resolvePath(original.configDirectory, allowSymlinks, false);
    const stateDirectory = resolvePath(original.stateDirectory, allowSymlinks);
    if (allowSymlinks) {
        validateDirectory(configDirectory);
        validateDirectory(stateDirectory);
    }
    const paths = instancePaths({ ...environment, KAIGI_CONFIG_DIR: configDirectory, KAIGI_STATE_DIR: stateDirectory }, { allowSymlinks });
    return { paths, values };
}

module.exports = { loadInstanceConfiguration, noSymlinks, resolvePath, validateDirectory };
