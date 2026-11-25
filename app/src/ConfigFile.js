'use strict';
const fs = require('node:fs');

function loadConfigFile(configPath, requiredFile = false) {
    try {
    if (!fs.existsSync(configPath)) {
        if (requiredFile) throw new Error(`Required configuration file is missing: ${configPath}`);
        return Object.create(null);
    }

    const values = new Map();

    for (const [lineNumber, sourceLine] of fs.readFileSync(configPath, 'utf8').split(/\r?\n/).entries()) {
        const line = sourceLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        const separator = line.indexOf('=');
        if (separator < 1) {
            throw new Error(`Invalid kaigi.conf entry at line ${lineNumber + 1}`);
        }

        const name = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            throw new Error(`Invalid kaigi.conf variable name at line ${lineNumber + 1}: ${name}`);
        }

        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }

        if (requiredFile && values.has(name)) throw new Error(`Duplicate ${configPath.endsWith('/ldap.conf') ? 'LDAP ' : ''}configuration setting: ${name}`);
        values.set(name, value);
    }

    const resolved = new Map();
    const resolving = new Set();

    const resolve = (name) => {
        if (resolved.has(name)) {
            return resolved.get(name);
        }
        if (!values.has(name)) {
            throw new Error(`Undefined kaigi.conf variable referenced: ${name}`);
        }
        if (resolving.has(name)) {
            throw new Error(`Circular kaigi.conf variable reference involving: ${name}`);
        }

        resolving.add(name);
        const value = values.get(name).replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, referencedName) => resolve(referencedName));
        resolving.delete(name);
        resolved.set(name, value);
        return value;
    };

    const config = Object.create(null);
    for (const name of values.keys()) {
        config[name] = resolve(name);
    }
    return config;
    } catch (error) {
        error.configResource = configPath.endsWith('/ldap/ldap.conf') ? 'ldap/ldap.conf' : 'kaigi.conf';
        throw error;
    }
}

module.exports = { loadConfigFile };
