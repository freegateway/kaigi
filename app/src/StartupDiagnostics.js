'use strict';

// Only catalogued reasons and bounded identifiers cross the inspector boundary.
// Never forward an exception message, file contents, configured value or stack.
const reasons = Object.freeze({
    proxy: 'invalid WEB_MODE/proxy/socket settings; require an HTTPS root WEB_URL, a private socket or explicit trusted proxy IPs and bind address, and a safe socket path',
    unknown: 'validation failed; check this resource',
    missing: 'file is missing', unreadable: 'file is not readable by the service account',
    access: 'access denied', file: 'cannot access file', unsafe: 'file must be regular and not group/world-writable',
    syntax: 'expected SETTING=value', variable: 'invalid variable name', duplicate: 'duplicate setting',
    undefined: 'references an undefined variable', circular: 'circular variable reference',
    service: 'belongs in the service environment, not this file', ldap: 'LDAP settings belong in ldap/ldap.conf',
    boolean: 'must be true or false', seconds: 'must be a non-negative integer number of seconds',
    deadline: 'must be an integer from 1 to 3600 seconds', workers: 'MEDIA_NUM_WORKERS must be a positive integer',
    port: 'must be an explicit integer port from 1 to 65535', range: 'MEDIA_MAX_PORT must not be below MEDIA_MIN_PORT',
    overlap: 'web and media port allocations must not overlap', url: 'set WEB_URL or WEB_LISTEN_HOST',
    small: 'media port range is too small for the WebRtcServer worker allocation',
    announced: 'MEDIA_ANNOUNCED_HOST and MEDIA_ANNOUNCED_IP are mutually exclusive',
    language: 'unsupported language code; consult UI_LANGUAGE/UI_LANGUAGES in kaigi.conf(5)',
    json: 'invalid JSON', translations: 'invalid site translations; consult kaigi.conf(5)',
    policy: 'invalid LDAP policy; check ldap.conf and group-meetings.json',
    jwt: 'JWT signing secret is invalid; use a private secret of at least 32 characters',
    origin: 'WEB_URL must be a valid HTTP(S) origin without credentials, query or fragment',
    local: 'WEB_LISTEN_HOST must resolve to exactly one local IPv4 address; set WEB_LISTEN_IP explicitly',
    dns: 'hostname resolution failed; check WEB_LISTEN_HOST and MEDIA_ANNOUNCED_HOST',
    media: 'set an unambiguous MEDIA_ANNOUNCED_IP or MEDIA_ANNOUNCED_HOST',
    tls: 'invalid TLS certificate/key or mismatched pair', account: 'service user/group does not exist or cannot be selected',
    recording: 'RECORDING_DIR must remain inside KAIGI_STATE_DIR', symlink: 'symlinks are not allowed in instance paths',
    grants: 'invalid local account meeting grants; use a JSON array of meeting keys',
    timeout: 'inspector exceeded its 15-second deadline', process: 'inspector could not complete',
});
const stages = new Set(['paths', 'credentials', 'account', 'configuration', 'network', 'tls', 'recordings']);
const resources = new Set(['instance paths', 'users', 'jwt-secret', 'service account', 'kaigi.conf', 'ldap/ldap.conf',
    'site-translations.json', 'TLS certificate', 'TLS private key', 'TLS certificate/key pair', 'state/recordings']);
const settingPattern = /^[A-Z][A-Z0-9_]{0,63}$/;

function diagnose(error, stage, resource) {
    const result = { stage, resource, reason: 'unknown' };
    if (resources.has(error?.configResource)) result.resource = error.configResource;
    const message = typeof error?.message === 'string' ? error.message : '';
    const exact = {
        'LDAP_ENABLED must be true or false': 'boolean',
        'MEDIA_NUM_WORKERS must be a positive integer': 'workers',
        'MEDIA_MAX_PORT must not be below MEDIA_MIN_PORT': 'range',
        'Web and media port allocations must not overlap': 'overlap',
        'Named instances require WEB_URL or WEB_LISTEN_HOST': 'url',
        'MEDIA_MIN_PORT..MEDIA_MAX_PORT is too small for the WebRtcServer worker allocation': 'small',
        'MEDIA_ANNOUNCED_HOST and MEDIA_ANNOUNCED_IP are mutually exclusive': 'announced',
        'RECORDING_DIR must remain inside KAIGI_STATE_DIR': 'recording',
        'Unsafe credential file': 'unsafe', 'Symlink in instance path': 'symlink',
    };
    if (Object.hasOwn(exact, message)) result.reason = exact[message];
    else {
        const line = message.match(/^Invalid kaigi\.conf (entry|variable name) at line ([1-9][0-9]{0,6})(?::[\s\S]*)?$/);
        const setting = message.match(/^(?:Duplicate (?:LDAP )?configuration setting: |Undefined kaigi\.conf variable referenced: |Circular kaigi\.conf variable reference involving: )([A-Z][A-Z0-9_]{0,63})$/);
        const value = message.match(/^([A-Z][A-Z0-9_]{0,63}) (must be a non-negative integer number of seconds|must be 1\.\.3600 seconds|is a service environment setting, not a kaigi\.conf setting)$/);
        const port = message.match(/^Named instances require an explicit valid ([A-Z][A-Z0-9_]{0,63})$/);
        if (message.startsWith('Required configuration file is missing: ')) result.reason = 'missing';
        else if (line) { result.reason = line[1] === 'entry' ? 'syntax' : 'variable'; result.line = Number(line[2]); }
        else if (setting) { result.setting = setting[1]; result.reason = message.startsWith('Duplicate') ? 'duplicate' : message.startsWith('Undefined') ? 'undefined' : 'circular'; }
        else if (value) { result.setting = value[1]; result.reason = value[2].startsWith('is ') ? 'service' : value[2].includes('3600') ? 'deadline' : 'seconds'; }
        else if (port) { result.setting = port[1]; result.reason = 'port'; }
        else if (/^LDAP_[A-Z0-9_]+ belongs in /.test(message)) result.reason = 'ldap';
        else if (/^Unsupported UI_LANGUAGES? code:/.test(message)) result.reason = 'language';
        else if (message.startsWith('Invalid meeting grants for local user ')) { result.resource = 'users'; result.reason = 'grants'; }
        else if (/^(Site translation|Invalid site translation|Unsupported site translation)/.test(message)) { result.resource = 'site-translations.json'; result.reason = message.includes('not valid JSON') ? 'json' : 'translations'; }
        else if (stage === 'account') result.reason = 'account';
        else if (stage === 'network') result.reason = message.startsWith('WEB_LISTEN_HOST ') ? 'local' : ['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code) ? 'dns' : 'media';
        else if (stage === 'tls') result.reason = 'tls';
    }
    if (error?.code === 'ENOENT') result.reason = 'missing';
    else if (['EACCES', 'EPERM'].includes(error?.code)) result.reason = 'access';
    else if (['EISDIR', 'ENOTDIR', 'ELOOP'].includes(error?.code)) result.reason = 'file';
    if (['jwt', 'origin', 'proxy'].includes(error?.startupReason)) result.reason = error.startupReason;
    if (error?.startupReason === 'jwt') result.resource = 'jwt-secret';
    if (error?.name === 'LdapError') { result.resource = 'ldap/ldap.conf'; result.reason = 'policy'; }
    return result;
}

function formatDiagnostic(data) {
    if (!data || !stages.has(data.stage) || !resources.has(data.resource) || !Object.hasOwn(reasons, data.reason)) return null;
    const aliases = { SERVER_LISTEN_PORT: 'WEB_LISTEN_PORT', SFU_MIN_PORT: 'MEDIA_MIN_PORT', SFU_MAX_PORT: 'MEDIA_MAX_PORT' };
    const name = typeof data.setting === 'string' && settingPattern.test(data.setting) ? data.setting : null;
    const setting = name ? `: ${Object.hasOwn(aliases, name) ? aliases[name] : name}` : '';
    const line = Number.isInteger(data.line) && data.line > 0 && data.line <= 9999999 ? `, line ${data.line}` : '';
    return `${data.stage} validation failed (${data.resource}${line}${setting}): ${reasons[data.reason]}`;
}

module.exports = { diagnose, formatDiagnostic };
