'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const net = require('node:net');
const { Client, Filter, FilterParser, PasswordPolicyControl } = require('ldapts');
class LdapError extends Error {
    constructor(code, message) { super(message); this.name = 'LdapError'; this.code = code; }
}
const fail = (code, message) => { throw new LdapError(code, message); };
// Render resolved settings without logging credential contents or URL credentials.
const settingValue = (name, value) => {
    if (/PASSWORD|SECRET|TOKEN|API_KEY/.test(name) && !name.endsWith('_FILE') && name !== 'LDAP_PASSWORD_POLICY') return '<redacted>';
    if (value === undefined) return '<undefined>';
    if (name === 'LDAP_URL' && typeof value === 'string') {
        try {
            const url = new URL(value);
            if (url.username || url.password) { url.username = 'redacted'; url.password = 'redacted'; }
            if (url.search) url.search = '?redacted';
            if (url.hash) url.hash = '#redacted';
            value = url.href;
        } catch { return '<invalid URL; omitted to protect possible credentials>'; }
    }
    try { return JSON.stringify(value); } catch { return '<unprintable>'; }
};
const settingsContext = (values, names) => names.map((name) => `${name}=${settingValue(name, values[name])}`).join(', ');
const contextualFail = (values) => (code, message) => {
    const names = [...new Set(message.match(/\bLDAP_[A-Z_]+\b/g) || [])].filter(name => !message.includes(`${name}=${settingValue(name, values[name])}`));
    fail(code, names.length ? `${message} Resolved settings: ${settingsContext(values, names)}.` : message);
};
const configSettings = (c) => Object.fromEntries(Object.entries({
    LDAP_TRANSPORT: c.transport, LDAP_URL: c.url, LDAP_BIND_DN: c.bindDN,
    LDAP_BIND_PASSWORD_FILE: c.bindPasswordFile, LDAP_USER_BASE: c.userBase,
    LDAP_USER_SCOPE: c.userScope, LDAP_USER_FILTER: c.userFilter,
    LDAP_USERNAME_ATTRIBUTE: c.usernameAttribute, LDAP_DISPLAY_NAME_ATTRIBUTE: c.displayNameAttribute,
    LDAP_CONNECT_TIMEOUT_MS: c.connectTimeout, LDAP_OPERATION_TIMEOUT_MS: c.timeout,
    LDAP_MAX_GROUPS: c.maxGroups, LDAP_PASSWORD_POLICY: c.passwordPolicy,
    LDAP_GROUPS_ENABLED: c.groupsEnabled, LDAP_GROUP_SOURCE: c.groupSource,
    LDAP_USER_GROUP_ATTRIBUTE: c.userGroupAttribute, LDAP_GROUP_BASE: c.groupBase,
    LDAP_GROUP_SCOPE: c.groupScope, LDAP_GROUP_FILTER: c.groupFilter,
    LDAP_GROUP_NAME_ATTRIBUTE: c.groupNameAttribute, LDAP_GROUP_MEMBER_VALUE: c.memberValue,
    LDAP_GROUP_UNIQUE_FILTER: c.groupUniqueFilter, LDAP_MEETING_MODE: c.mode,
    LDAP_MAPPING_KEY: c.mappingKey, 
    LDAP_TLS_CA_FILE: c.caFile,
    LDAP_TLS_MIN_VERSION: c.tlsMinVersion, LDAP_TLS_SERVER_NAME: c.tlsServerName,
    LDAP_SESSION_MAX_AGE: c.maxAgeMs === undefined ? undefined : c.maxAgeMs / 1000,
}));
const safeCause = (error) => {
    const code = String(error?.code ?? '');
    const name = String(error?.name ?? 'Error');
    return /^[A-Z0-9_]{1,64}$/.test(code) ? code : /^[A-Za-z]{1,64}$/.test(name) ? name : 'Error';
};
const io = async (description, action) => {
    try { return await action(); }
    catch (error) {
        if (error instanceof LdapError) throw error;
        fail('DIRECTORY_UNAVAILABLE', `${description} failed (${safeCause(error)}). Check filesystem file/directory permissions, LDAP directory service availability, and LDAP transport configuration.`);
    }
};
const text = (v) => typeof v === 'string' && v.length > 0 && !v.includes('\0');
const attribute = (v) => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(v);
const { isMeetingKey: room, meetingKeyRules, readOptional, parseJSON, isObject } = require('./MeetingSettings');
function rooms(values) {
    if (!Array.isArray(values) || !values.every(room)) fail('INVALID_POLICY', `Meeting grants must be an array of valid keys: ${meetingKeyRules}. Rejected values=${JSON.stringify(Array.isArray(values) ? values.filter(value => !room(value)) : values)}.`);
    return [...new Set(values)].sort();
}
function scalar(entry, name, required = true) {
    const key = Object.keys(entry).find((k) => k.toLowerCase() === name.toLowerCase());
    let value = key === undefined ? undefined : entry[key];
    if (Array.isArray(value)) value = value.length === 1 ? value[0] : undefined;
    if (!text(value)) { if (required) fail('INVALID_DIRECTORY_ENTRY', `LDAP entry attribute ${name} must contain exactly one nonempty string without NUL characters.`); return undefined; }
    return value;
}
class MeetingPolicy {
    #mapping = new Map();
    #loaded = false;
    #key;
    #filename;
    #defaultGroups = [];
    constructor({ mode, mappingKey = 'name' }) {
        const fail = contextualFail({ LDAP_MEETING_MODE: mode, LDAP_MAPPING_KEY: mappingKey });
        if (!['direct', 'mapped'].includes(mode)) fail('INVALID_POLICY', 'LDAP_MEETING_MODE must be direct or mapped.');
        if (!['name', 'dn'].includes(mappingKey)) fail('INVALID_POLICY', 'LDAP_MAPPING_KEY must be name or dn.');
        this.#key = mappingKey;
        this.mode = mode;
        Object.defineProperty(this, 'mode', { writable: false });
    }
    async reload(filename, audit = () => {}) {
        const fail = (code, message) => contextualFail({ LDAP_MEETING_MODE: this.mode, LDAP_MAPPING_KEY: this.#key })(code, `${message} File=${JSON.stringify(filename)}.`);
        audit('info', 'LDAP group-meeting policy load started', { filename, meetingMode: this.mode, mappingKey: this.#key });
        let data;
        try {
            const source = readOptional(filename);
            if (source === null) {
                if (this.mode === 'mapped') fail('INVALID_POLICY', 'group-meetings.json is missing; mapped mode requires groupMeetings grants.');
                data = { defaultGroups: [], groupMeetings: {} };
            } else data = parseJSON(source, filename);
        } catch (error) { if (error instanceof LdapError) throw error; fail('INVALID_POLICY', `Cannot load group-meetings.json: ${error.message}`); }
        if (!isObject(data) || Object.keys(data).some(key => !['defaultGroups', 'groupMeetings'].includes(key)) || !Array.isArray(data.defaultGroups) || !isObject(data.groupMeetings)) fail('INVALID_POLICY', 'group-meetings.json requires exactly defaultGroups (array) and groupMeetings (object).');
        const validGroup = this.mode === 'mapped' && this.#key === 'dn' ? text : room;
        if (!data.defaultGroups.every(validGroup) || new Set(data.defaultGroups).size !== data.defaultGroups.length) fail('INVALID_POLICY', 'group-meetings.json defaultGroups must contain unique, valid group keys.');
        const candidate = new Map();
        for (const [group, values] of Object.entries(data.groupMeetings)) {
            if (!validGroup(group)) fail('INVALID_POLICY', `group-meetings.json contains invalid group key=${JSON.stringify(group)}.`);
            const grants = rooms(values);
            if (!grants.length) fail('INVALID_POLICY', `group-meetings.json group=${JSON.stringify(group)} must grant at least one meeting.`);
            candidate.set(group, grants);
        }
        this.#filename = filename;
        this.#mapping = candidate;
        this.#defaultGroups = [...data.defaultGroups];
        this.#loaded = true;
        audit(this.mode === 'mapped' && !candidate.size ? 'warn' : 'info', 'LDAP group-meeting policy load completed', { filename, defaultGroupCount: this.#defaultGroups.length, mappingCount: candidate.size });
    }
    defaultGroups(maximum) {
        if (this.#defaultGroups.length > maximum) fail('INVALID_DEFAULT_GROUPS', `group-meetings.json defaultGroups exceeds LDAP_MAX_GROUPS=${maximum}.`);
        return this.#defaultGroups.map(key => this.mode === 'mapped' && this.#key === 'dn' ? { dn: key } : { name: key });
    }
    resolve(groups, audit = () => {}) {
        const fail = (code, message) => contextualFail({ LDAP_MEETING_MODE: this.mode, LDAP_MAPPING_KEY: this.#key })(code, `${message} File=${JSON.stringify(this.#filename)}.`);
        if (this.mode === 'mapped' && !this.#loaded) fail('POLICY_NOT_LOADED', 'Mapped meeting policy has not been loaded successfully from group-meetings.json.');
        if (!Array.isArray(groups)) fail('INVALID_DIRECTORY_ENTRY', 'LDAP membership result must be an array of groups.');
        if (!groups.length) { audit('warn', 'LDAP meeting assignment: no groups', { meetings: [] }); return []; }
        const granted = [], names = new Map();
        for (const group of groups) {
            if (!group || ((this.mode === 'direct' || this.#key === 'name') && !text(group.name)) || (this.#key === 'dn' && this.mode === 'mapped' && !text(group.dn))) fail('INVALID_DIRECTORY_ENTRY', 'LDAP group entry lacks the nonempty name or DN required by the selected meeting mapping policy.');
            if (this.mode === 'mapped' && this.#key === 'name' && !room(group.name)) fail('INVALID_DIRECTORY_ENTRY', `Invalid LDAP group name=${JSON.stringify(group.name)}; expected ${meetingKeyRules}.`);
            if (this.mode === 'direct') {
                if (!room(group.name)) fail('INVALID_GROUP_ROOM', `LDAP_MEETING_MODE="direct" rejected group name=${JSON.stringify(group.name)}${group.dn ? `, group DN=${JSON.stringify(group.dn)}` : ''}. Expected ${meetingKeyRules}.`);
                if (names.has(group.name) && names.get(group.name) !== group.dn) fail('AMBIGUOUS_GROUP_ROOM', 'Different LDAP group DNs share a direct meeting name; group names must be unique.');
                names.set(group.name, group.dn);
                granted.push(group.name);
            } else {
                const key = group[this.#key], mapped = this.#mapping.get(key) || [];
                audit(mapped.length ? 'info' : 'warn', mapped.length ? 'LDAP group mapping matched' : 'LDAP group has no meeting mapping', { mappingKey: this.#key, group: key, meetings: mapped, filename: this.#filename });
                granted.push(...mapped);
            }
        }
        return rooms(granted);
    }
}
class LdapAuthenticator {
    #config; #policy; #factory;
    constructor(config, policy, { clientFactory = (options) => new Client(options) } = {}) {
        const c = { ...config };
        const resolved = configSettings(c);
        const fail = contextualFail(resolved);
        if (c.transport === 'ldapi') fail('INVALID_CONFIG', 'LDAP_TRANSPORT=ldapi is not implemented');
        let url;
        try { url = new URL(c.url); } catch { fail('INVALID_CONFIG', 'LDAP_URL must be a valid absolute LDAP URL with an explicit port.'); }
        if (!['ldaps:', 'ldap:'].includes(url.protocol) || !url.port || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('INVALID_CONFIG', 'LDAP_URL requires ldap:// or ldaps://, a hostname or literal address, and an explicit port; credentials, query, fragment, and non-root paths are forbidden.');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const loopback = (net.isIP(host) === 4 && host.startsWith('127.')) || host === '::1';
        if (!['ldaps', 'ldap-starttls', 'ldap-plain'].includes(c.transport) ||
            (c.transport === 'ldaps' ? url.protocol !== 'ldaps:' : url.protocol !== 'ldap:') ||
            (c.transport === 'ldap-plain' && (!loopback || c.caFile || c.startTLS === true)) ||
            (c.transport === 'ldap-starttls' && c.startTLS === false) ||
            (c.transport === 'ldaps' && c.startTLS === true)) fail('INVALID_CONFIG', 'LDAP_TRANSPORT must match LDAP_URL: ldaps requires ldaps://; ldap-starttls and ldap-plain require ldap://. ldap-plain allows literal 127.0.0.0/8 or ::1 only and forbids TLS settings. TLS upgrade flags must agree with the selected transport.');
        // Store the validated URL, including its canonical literal address.
        c.url = url.href;
        for (const key of ['bindDN', 'bindPasswordFile', 'userBase', 'userFilter']) if (!text(c[key])) fail('INVALID_CONFIG', `LDAP setting ${({bindDN: "LDAP_BIND_DN", bindPasswordFile: "LDAP_BIND_PASSWORD_FILE", userBase: "LDAP_USER_BASE", userFilter: "LDAP_USER_FILTER", usernameAttribute: "LDAP_USERNAME_ATTRIBUTE", displayNameAttribute: "LDAP_DISPLAY_NAME_ATTRIBUTE", connectTimeout: "LDAP_CONNECT_TIMEOUT_MS", timeout: "LDAP_OPERATION_TIMEOUT_MS", maxGroups: "LDAP_MAX_GROUPS"})[key]} must be a nonempty string without NUL characters.`);
        for (const key of ['usernameAttribute', 'displayNameAttribute']) if (!attribute(c[key])) fail('INVALID_CONFIG', `LDAP setting ${({bindDN: "LDAP_BIND_DN", bindPasswordFile: "LDAP_BIND_PASSWORD_FILE", userBase: "LDAP_USER_BASE", userFilter: "LDAP_USER_FILTER", usernameAttribute: "LDAP_USERNAME_ATTRIBUTE", displayNameAttribute: "LDAP_DISPLAY_NAME_ATTRIBUTE", connectTimeout: "LDAP_CONNECT_TIMEOUT_MS", timeout: "LDAP_OPERATION_TIMEOUT_MS", maxGroups: "LDAP_MAX_GROUPS"})[key]} must be an attribute name beginning with a letter and containing only letters, digits, or hyphens.`);
        for (const key of ['connectTimeout', 'timeout', 'maxGroups']) if (!Number.isSafeInteger(c[key]) || c[key] <= 0) fail('INVALID_CONFIG', `LDAP setting ${({bindDN: "LDAP_BIND_DN", bindPasswordFile: "LDAP_BIND_PASSWORD_FILE", userBase: "LDAP_USER_BASE", userFilter: "LDAP_USER_FILTER", usernameAttribute: "LDAP_USERNAME_ATTRIBUTE", displayNameAttribute: "LDAP_DISPLAY_NAME_ATTRIBUTE", connectTimeout: "LDAP_CONNECT_TIMEOUT_MS", timeout: "LDAP_OPERATION_TIMEOUT_MS", maxGroups: "LDAP_MAX_GROUPS"})[key]} must be a positive safe integer.`);
        if (!['dn', 'username'].includes(c.memberValue) || !(policy instanceof MeetingPolicy) || typeof c.passwordPolicy !== 'boolean') fail('INVALID_CONFIG', 'LDAP_GROUP_MEMBER_VALUE must be dn or username, LDAP_PASSWORD_POLICY must be boolean, and a valid MeetingPolicy is required.');
        if (!['base', 'one', 'sub'].includes(c.userScope) || !['base', 'one', 'sub'].includes(c.groupScope) || typeof c.groupsEnabled !== 'boolean') fail('INVALID_CONFIG', 'LDAP_USER_SCOPE and LDAP_GROUP_SCOPE must be base, one, or sub; LDAP_GROUPS_ENABLED must be boolean.');
        if (!c.userFilter.includes('{username}')) fail('INVALID_CONFIG', 'LDAP_USER_FILTER must contain the {username} placeholder.');
        if (c.groupsEnabled) {
            if (!['user-attribute', 'group-search'].includes(c.groupSource)) fail('INVALID_CONFIG', 'LDAP_GROUP_SOURCE must be user-attribute or group-search when LDAP_GROUPS_ENABLED=true.');
            if (c.groupSource === 'user-attribute') {
                if (!attribute(c.userGroupAttribute) || (policy.mode === 'mapped' && c.mappingKey !== 'name')) fail('INVALID_CONFIG', 'User-entry groups require a valid LDAP_USER_GROUP_ATTRIBUTE and LDAP_MAPPING_KEY=name in mapped mode.');
            } else if (!text(c.groupBase) || !text(c.groupFilter) || !c.groupFilter.includes('{member}') || !attribute(c.groupNameAttribute) || ((policy.mode === 'direct' || c.mappingKey === 'name') && (!text(c.groupUniqueFilter) || !c.groupUniqueFilter.includes('{group}')))) fail('INVALID_CONFIG', 'Group search requires LDAP_GROUP_BASE, LDAP_GROUP_FILTER with {member}, and LDAP_GROUP_NAME_ATTRIBUTE. Direct mode and name mappings also require LDAP_GROUP_UNIQUE_FILTER with {group}.');
        }
        this.#config = Object.freeze(c); this.#policy = policy; this.#factory = clientFactory;
    }
    async #connection() {
        const c = this.#config;
        const fail = contextualFail(configSettings(c));
        const tlsOptions = { minVersion: c.tlsMinVersion, rejectUnauthorized: true };
        if (c.tlsServerName) tlsOptions.servername = c.tlsServerName;
        if (c.transport !== 'ldap-plain' && c.caFile) tlsOptions.ca = await io(`Reading LDAP_TLS_CA_FILE=${JSON.stringify(c.caFile)}`, () => fs.readFile(c.caFile));
        const options = { url: c.url, connectTimeout: c.connectTimeout, timeout: c.timeout, autoRebind: false, strictDN: true };
        if (c.transport === 'ldaps') options.tlsOptions = tlsOptions;
        if (c.transport === 'ldap-starttls') {
            let connected = false;
            // A StartTLS connection must never transparently reconnect in plaintext.
            options.createConnection = (port, host) => {
                if (connected) fail('DIRECTORY_UNAVAILABLE', 'StartTLS connection was lost; refusing automatic plaintext reconnect. Retry the login after checking the LDAP directory service.');
                connected = true;
                return net.connect(port, host);
            };
        }
        const client = this.#factory(options);
        try {
            if (c.transport === 'ldap-starttls') await client.startTLS(tlsOptions);
            return client;
        } catch (error) { await client.unbind().catch(() => {}); throw error; }
    }
    async #search(client, base, filter, attributes, scope, operation) {
        const fail = contextualFail(configSettings(this.#config));
        if (!client.isBound || !client.isConnected) fail('DIRECTORY_UNAVAILABLE', 'LDAP search requires a connected, bound search-account connection; the connection was lost or its bind state changed.');
        // No sizeLimit: ldapts accepts truncated results when a client sizeLimit is set.
        const result = await io(`${operation}; resolved search base=${JSON.stringify(base)}, scope=${JSON.stringify(scope)}, filter=${JSON.stringify(filter)}, attributes=${JSON.stringify(attributes)}`, () => client.search(base, { scope, filter, attributes, paged: false }));
        if (!client.isBound || !client.isConnected) fail('DIRECTORY_UNAVAILABLE', 'LDAP search requires a connected, bound search-account connection; the connection was lost or its bind state changed.');
        if (result.searchReferences?.length || !Array.isArray(result.searchEntries)) fail('INCOMPLETE_DIRECTORY_SEARCH', 'LDAP search returned referrals or an invalid result. Configure a search base with complete local results; referrals are not followed.');
        return result.searchEntries;
    }
    async authenticate(username, password, audit = () => {}) {
        const fail = contextualFail(configSettings(this.#config));
        if (!text(username) || username.length > 256 || !text(password) || password.length > 4096) fail('INVALID_CREDENTIALS', 'LDAP login requires a nonempty username (maximum 256 characters) and password (maximum 4096 characters), without NUL characters.');
        const c = this.#config;
        let searchClient, userClient;
        let stage = 'Reading LDAP_BIND_PASSWORD_FILE';
        const setStage = (value) => { stage = value; audit('info', 'LDAP login step', { operation: operation() }); };
        const operation = () => `${stage}; ${settingsContext(configSettings(c), [...new Set((stage.match(/\bLDAP_[A-Z_]+\b/g) || []).concat(['LDAP_TRANSPORT', 'LDAP_URL']))])}`;
        try {
            setStage(stage);
            let secret;
            const handle = await fs.open(c.bindPasswordFile, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o027)) fail('UNSAFE_SECRET_FILE', `LDAP_BIND_PASSWORD_FILE ${c.bindPasswordFile} must be a regular file no larger than 4096 bytes with no group-write or other access; use mode 0600 or 0640 and appropriate ownership.`);
                secret = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
            } finally { await handle.close(); }
            if (!text(secret)) fail('INVALID_CONFIG', `LDAP_BIND_PASSWORD_FILE ${c.bindPasswordFile} must contain one nonempty password without NUL characters.`);
            setStage('Connecting search account using LDAP_TRANSPORT and LDAP_URL');
            searchClient = await this.#connection();
            setStage('Binding search account using LDAP_BIND_DN and LDAP_BIND_PASSWORD_FILE');
            await searchClient.bind(c.bindDN, secret);
            audit('info', 'LDAP search-account bind succeeded', { bindDN: c.bindDN });
            setStage('Searching user entries using LDAP_USER_BASE, LDAP_USER_SCOPE, and LDAP_USER_FILTER');
            const users = await this.#search(searchClient, c.userBase, c.userFilter.replaceAll('{username}', Filter.escape(username)), [c.usernameAttribute, c.displayNameAttribute, ...(c.groupsEnabled && c.groupSource === 'user-attribute' ? [c.userGroupAttribute] : [])], c.userScope, operation());
            audit('info', 'LDAP user search completed', { matchCount: users.length });
            if (users.length !== 1) fail('INVALID_CREDENTIALS', `LDAP_USER_BASE and LDAP_USER_FILTER returned ${users.length} user entries; exactly one is required. Check the search account ACLs, base, scope, and login filter.`);
            const entry = users[0], dn = scalar(entry, 'dn'), canonicalUsername = scalar(entry, c.usernameAttribute);
            setStage('Connecting for separate user-password bind');
            userClient = await this.#connection();
            setStage(`Binding the unique LDAP user using resolved user DN=${JSON.stringify(dn)} and the submitted password`);
            const control = c.passwordPolicy ? new PasswordPolicyControl() : undefined;
            try { await userClient.bind(dn, password, control); }
            catch (error) { if (error.code === 49 || error.name === 'InvalidCredentialsError') fail('INVALID_CREDENTIALS', 'LDAP user-password bind was rejected by the LDAP directory service.'); throw error; }
            if (control?.value?.error !== undefined || control?.value?.graceAuthNsRemaining !== undefined) fail('PASSWORD_POLICY_REJECTED', 'LDAP password-policy control rejected the user bind or indicated a grace login. Resolve the account password policy in the LDAP directory service.');
            audit('info', 'LDAP user authentication succeeded', { loginName: canonicalUsername, userDN: dn });
            let groups = [];
            setStage('Resolving LDAP groups using LDAP_GROUPS_ENABLED and LDAP_GROUP_SOURCE');
            if (c.groupsEnabled && c.groupSource === 'user-attribute') {
                const key = Object.keys(entry).find((name) => name.toLowerCase() === c.userGroupAttribute.toLowerCase());
                const value = key === undefined ? [] : entry[key];
                const values = Array.isArray(value) ? value : [value];
                if (values.length > c.maxGroups || !values.every(text)) fail('INVALID_DIRECTORY_ENTRY', `LDAP_USER_GROUP_ATTRIBUTE ${c.userGroupAttribute} must contain nonempty strings without NUL characters and at most LDAP_MAX_GROUPS (${c.maxGroups}) values.`);
                groups = [...new Set(values)].map((name) => ({ name }));
            } else if (c.groupsEnabled) {
                const member = c.memberValue === 'dn' ? dn : canonicalUsername;
                setStage('Searching LDAP group entries using LDAP_GROUP_BASE, LDAP_GROUP_SCOPE, LDAP_GROUP_FILTER and LDAP_GROUP_MEMBER_VALUE');
                const entries = await this.#search(searchClient, c.groupBase, c.groupFilter.replaceAll('{member}', Filter.escape(member)), [c.groupNameAttribute], c.groupScope, operation());
                if (entries.length > c.maxGroups) fail('GROUP_LIMIT_EXCEEDED', `LDAP group search returned ${entries.length} entries, exceeding LDAP_MAX_GROUPS (${c.maxGroups}). Review the group filter or limit.`);
                groups = entries.map((group) => ({ dn: scalar(group, 'dn'), name: scalar(group, c.groupNameAttribute) }));
                if (this.#policy.mode === 'direct' || c.mappingKey === 'name') {
                    for (const group of groups) {
                        setStage('Checking LDAP group-name uniqueness using LDAP_GROUP_BASE, LDAP_GROUP_SCOPE and LDAP_GROUP_UNIQUE_FILTER');
                        const matches = await this.#search(searchClient, c.groupBase, c.groupUniqueFilter.replaceAll('{group}', Filter.escape(group.name)), [c.groupNameAttribute], c.groupScope, operation());
                        if (matches.length !== 1 || scalar(matches[0], 'dn') !== group.dn) fail('AMBIGUOUS_GROUP_ROOM', 'LDAP_GROUP_UNIQUE_FILTER did not return exactly the expected group DN. Group names must be unique for direct mode or name mappings.');
                    }
                }
            }
            if (!groups.length) {
                groups = this.#policy.defaultGroups(c.maxGroups);
                audit('info', 'LDAP fallback group selection completed', { groups, groupCount: groups.length, filename: c.groupMeetingsFile });
            }
            audit('info', 'LDAP group resolution completed', { groups, groupCount: groups.length });
            setStage('Assigning meetings using LDAP_MEETING_MODE and LDAP_MAPPING_KEY');
            const assignedRooms = this.#policy.resolve(groups, audit);
            audit(assignedRooms.length ? 'info' : 'warn', 'LDAP meeting assignment completed', { loginName: canonicalUsername, meetings: assignedRooms, meetingCount: assignedRooms.length, message: assignedRooms.length ? 'Meeting grants resolved.' : 'Authentication succeeded, but no meetings are authorized. Check group membership, fallback groups, and group-meetings.json grants.' });
            if (!assignedRooms.length) fail('NO_MEETING_GRANTS', 'LDAP credentials were verified, but login is denied because no meetings are authorized. Check LDAP_GROUPS_ENABLED and LDAP_MEETING_MODE, and the defaults/grants in group-meetings.json.');
            const directoryDisplayName = scalar(entry, c.displayNameAttribute, false);
            return { username: canonicalUsername, displayName: directoryDisplayName || canonicalUsername, dn, groups, rooms: assignedRooms, ldapAttributes: { username: { name: c.usernameAttribute, value: canonicalUsername }, displayName: { name: c.displayNameAttribute, value: directoryDisplayName ?? null } } };
        } catch (error) {
            if (error instanceof LdapError) throw error;
            fail('DIRECTORY_UNAVAILABLE', `${operation()} failed (${safeCause(error)}). Check LDAP directory service availability, LDAP transport/TLS configuration, filesystem file permissions, and search-account ACLs.`);
        } finally {
            audit('info', 'LDAP connection cleanup started');
            await Promise.all([searchClient, userClient].filter(Boolean).map((client) => client.unbind().catch((error) => { audit('warn', 'LDAP connection cleanup failed', { cause: safeCause(error) }); })));
            audit('info', 'LDAP connection cleanup completed');
        }
    }
}


// LDAP settings come exclusively from the parsed ldap/ldap.conf values.
// Certificate verification, separate user binds and denial on errors are mandatory.
function ldapConfig(values, groupMeetingsFile) {
    values = {
        LDAP_CONNECT_TIMEOUT_MS: '3000',
        LDAP_OPERATION_TIMEOUT_MS: '5000',
        LDAP_MAX_GROUPS: '1000',
        LDAP_PASSWORD_POLICY: 'true',
        LDAP_SESSION_MAX_AGE: '28800',
        LDAP_TLS_MIN_VERSION: 'TLSv1.2',
        LDAP_TLS_SERVER_NAME: '',
        ...values,
    };
    const fail = contextualFail(values);
    const supported = new Set(["LDAP_ENABLED", "LDAP_TRANSPORT", "LDAP_URL", "LDAP_BIND_DN", "LDAP_BIND_PASSWORD_FILE", "LDAP_USER_BASE", "LDAP_USER_SCOPE", "LDAP_USER_FILTER", "LDAP_USERNAME_ATTRIBUTE", "LDAP_DISPLAY_NAME_ATTRIBUTE", "LDAP_GROUPS_ENABLED", "LDAP_CONNECT_TIMEOUT_MS", "LDAP_OPERATION_TIMEOUT_MS", "LDAP_MAX_GROUPS", "LDAP_PASSWORD_POLICY", "LDAP_MEETING_MODE", "LDAP_SESSION_MAX_AGE", "LDAP_GROUP_BASE", "LDAP_GROUP_SCOPE", "LDAP_GROUP_FILTER", "LDAP_GROUP_NAME_ATTRIBUTE", "LDAP_GROUP_MEMBER_VALUE", "LDAP_GROUP_UNIQUE_FILTER", "LDAP_TLS_CA_FILE", "LDAP_TLS_MIN_VERSION", "LDAP_TLS_SERVER_NAME", "LDAP_ENABLED", "LDAP_GROUP_SOURCE", "LDAP_USER_GROUP_ATTRIBUTE", "LDAP_MAPPING_KEY"]);
    for (const name of Object.keys(values)) {
        if (name.startsWith('LDAP_') && !supported.has(name)) fail('INVALID_CONFIG', `Unknown ldap.conf LDAP setting: ${name}`);
    }
    const required = (name, empty = false) => {
        if (!Object.hasOwn(values, name) || typeof values[name] !== 'string' || (!empty && !values[name]) || values[name].includes('\0')) fail('INVALID_CONFIG', `${name} is required in ldap/ldap.conf and must be a string without NUL characters${empty ? '; an explicitly empty value is permitted' : '; a nonempty value is required'}.`);
        return values[name];
    };
    const boolean = (name) => {
        const value = required(name);
        if (!['true', 'false'].includes(value)) fail('INVALID_CONFIG', `${name} must be exactly true or false.`);
        return value === 'true';
    };
    const number = (name) => {
        const value = required(name);
        if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('INVALID_CONFIG', `${name} must be a positive decimal safe integer.`);
        return Number(value);
    };
    // An absent enable switch keeps existing installations local-only.
    if (!Object.hasOwn(values, 'LDAP_ENABLED')) return { enabled: false };
    if (!boolean('LDAP_ENABLED')) return { enabled: false };
    const result = {
        enabled: true,
        transport: required('LDAP_TRANSPORT'),
        url: required('LDAP_URL'),
        bindDN: required('LDAP_BIND_DN'),
        bindPasswordFile: required('LDAP_BIND_PASSWORD_FILE'),
        userBase: required('LDAP_USER_BASE'),
        userScope: required('LDAP_USER_SCOPE'),
        userFilter: required('LDAP_USER_FILTER'),
        usernameAttribute: required('LDAP_USERNAME_ATTRIBUTE'),
        displayNameAttribute: required('LDAP_DISPLAY_NAME_ATTRIBUTE'),
        groupsEnabled: boolean('LDAP_GROUPS_ENABLED'),
        groupScope: 'sub',
        memberValue: 'dn',
        connectTimeout: number('LDAP_CONNECT_TIMEOUT_MS'),
        timeout: number('LDAP_OPERATION_TIMEOUT_MS'),
        maxGroups: number('LDAP_MAX_GROUPS'),
        passwordPolicy: boolean('LDAP_PASSWORD_POLICY'),
        mode: required('LDAP_MEETING_MODE'),
        maxAgeMs: number('LDAP_SESSION_MAX_AGE') * 1000,
    };
    if (!Number.isSafeInteger(result.maxAgeMs)) fail('INVALID_CONFIG', 'LDAP_SESSION_MAX_AGE is too large to represent safely in milliseconds.');
    result.mappingKey = result.mode === 'mapped' ? required('LDAP_MAPPING_KEY') : 'name';
    if (result.groupsEnabled) {
        result.groupSource = required('LDAP_GROUP_SOURCE');
        if (result.groupSource === 'user-attribute') {
            result.userGroupAttribute = required('LDAP_USER_GROUP_ATTRIBUTE');
        } else if (result.groupSource === 'group-search') {
            result.groupBase = required('LDAP_GROUP_BASE');
            result.groupScope = required('LDAP_GROUP_SCOPE');
            result.groupFilter = required('LDAP_GROUP_FILTER');
            result.groupNameAttribute = required('LDAP_GROUP_NAME_ATTRIBUTE');
            result.memberValue = required('LDAP_GROUP_MEMBER_VALUE');
            if (result.mode === 'direct' || result.mappingKey === 'name') result.groupUniqueFilter = required('LDAP_GROUP_UNIQUE_FILTER');
        } else fail('INVALID_CONFIG', 'LDAP_GROUP_SOURCE must be user-attribute or group-search.');
    }
    result.groupMeetingsFile = groupMeetingsFile;
    if (!path.isAbsolute(groupMeetingsFile || '')) fail('INVALID_CONFIG', 'group-meetings.json requires an absolute configuration path.');
    if (result.transport === 'ldapi') fail('INVALID_CONFIG', 'LDAP_TRANSPORT=ldapi is not implemented');
    if (result.transport !== 'ldap-plain') {
        result.caFile = required('LDAP_TLS_CA_FILE');
        result.tlsMinVersion = required('LDAP_TLS_MIN_VERSION');
        result.tlsServerName = required('LDAP_TLS_SERVER_NAME', true);
        if (!['TLSv1.2', 'TLSv1.3'].includes(result.tlsMinVersion)) fail('INVALID_CONFIG', 'LDAP_TLS_MIN_VERSION must be TLSv1.2 or TLSv1.3.');
    }
    for (const [setting, filename] of [['LDAP_BIND_PASSWORD_FILE', result.bindPasswordFile], ['LDAP_TLS_CA_FILE', result.caFile]]) if (filename && !path.isAbsolute(filename)) fail('INVALID_CONFIG', `${setting} must be an absolute filesystem path.`);
    for (const [setting, filter, placeholder] of [['LDAP_USER_FILTER', result.userFilter, '{username}'], ...(result.groupsEnabled && result.groupSource === 'group-search' ? [['LDAP_GROUP_FILTER', result.groupFilter, '{member}']] : []), ...(result.groupsEnabled && result.groupSource === 'group-search' && (result.mode === 'direct' || result.mappingKey === 'name') ? [['LDAP_GROUP_UNIQUE_FILTER', result.groupUniqueFilter, '{group}']] : [])]) {
        if (!filter.includes(placeholder) || /\{[^}]*\}/.test(filter.replaceAll(placeholder, 'test'))) fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`);
        const probe = filter.replaceAll(placeholder, 'test');
        let depth = 0;
        if (!probe.startsWith('(') || !probe.endsWith(')')) fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`);
        for (let index = 0; index < probe.length; index++) {
            if (probe[index] === '\\') { index += 2; continue; }
            if (probe[index] === '(') depth++;
            if (probe[index] === ')' && --depth < 0) fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`);
            if (depth === 0 && index !== probe.length - 1) fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`);
        }
        if (depth !== 0) fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`);
        try { FilterParser.parseString(probe); } catch { fail('INVALID_CONFIG', `${setting} must be a valid, balanced LDAP filter containing ${placeholder} and no unsupported placeholders.`); }
    }
    return Object.freeze(result);
}

function createLdapBackend(config, { onEvent = () => {} } = {}) {
    if (!config?.enabled) return null;
    const policy = new MeetingPolicy({ mode: config.mode, defaultRooms: [], mappingKey: config.mappingKey });
    const authenticator = new LdapAuthenticator(config, policy);
    return {
        maxAgeMs: config.maxAgeMs,
        async authenticate(username, password, context = {}) {
            const audit = (level, message, details = {}) => onEvent(level, message, { loginName: username, ip: context.ip, attemptId: context.attemptId, ...details });
            audit('info', 'LDAP login started');
            try {
                // Every new LDAP login validates the complete current group-to-meeting policy.
                await policy.reload(config.groupMeetingsFile, audit);
                return await authenticator.authenticate(username, password, audit);
            } catch (error) {
                audit('warn', 'LDAP login failed', { code: error.code || 'LDAP_ERROR', message: error instanceof LdapError ? error.message : `LDAP operation failed (${safeCause(error)}).` });
                throw error;
            }
        },
    };
}
module.exports = { ldapConfig, createLdapBackend, LdapAuthenticator, MeetingPolicy, LdapError };
