'use strict';
// Fixed reasons and typed metadata only. Never render LDAP server messages or credentials.
const reasons = Object.freeze({
    INVALID_CONFIG: 'invalid LDAP configuration; correct the indicated setting in ldap/ldap.conf',
    INVALID_POLICY: 'invalid meeting mapping; check the JSON structure, defaults and grants in group-meetings.json',
    UNSAFE_SECRET_FILE: 'bind-secret must be a root-owned regular file, mode 0600, at most 4096 bytes',
    SECRET_MISSING: 'bind-secret is missing; install the configured file owned by root with mode 0600',
    SECRET_ACCESS: 'cannot read bind-secret during privileged startup; check the file and parent directory permissions',
    SECRET_SYMLINK: 'bind-secret must not be a symbolic link; install a regular root-owned file with mode 0600',
    SECRET_CONTENT: 'bind-secret must be nonempty and contain no NUL characters',
    SECRET_IO: 'cannot open or read bind-secret; check the configured path and filesystem',
    INVALID_CREDENTIALS: 'user authentication failed; verify credentials and that the user search returns exactly one entry',
    PASSWORD_POLICY_REJECTED: 'directory password policy rejected login; resolve the account password policy',
    INVALID_DIRECTORY_ENTRY: 'directory entry has a missing, ambiguous or invalid attribute; check the configured attribute and directory schema',
    GROUP_LIMIT_EXCEEDED: 'group search exceeds LDAP_MAX_GROUPS; narrow the filter or review the limit',
    AMBIGUOUS_GROUP_ROOM: 'group lookup is ambiguous; LDAP_GROUP_UNIQUE_FILTER must resolve exactly one expected group',
    INCOMPLETE_DIRECTORY_SEARCH: 'directory search returned referrals or incomplete results; use a base containing complete local results',
    NO_MEETING_GRANTS: 'credentials verified but no meetings authorized; review groups and group-meetings.json defaults/grants',
    DIRECTORY_UNAVAILABLE: 'LDAP operation failed; check the indicated operation and cause',
});
const rules = Object.freeze({
    required: 'provide an explicit nonempty value without NUL characters',
    boolean: 'use exactly true or false', integer: 'use a positive safe decimal integer',
    url: 'use an absolute ldap:// or ldaps:// URL with explicit port, without credentials, query, fragment or path',
    transport: 'match LDAP_TRANSPORT to LDAP_URL; plaintext is restricted to literal loopback addresses',
    scope: 'use base, one or sub for search scope', attribute: 'use an LDAP attribute name beginning with a letter',
    filter: 'use a balanced LDAP filter with the required placeholder and no unsupported placeholders',
    groups: 'check LDAP_GROUP_SOURCE, group attributes, filters and mapping key',
    tls: 'use verified TLS with a readable CA file and minimum TLSv1.2 or TLSv1.3',
    unsupported: 'remove this unsupported LDAP setting or transport',
    structure: 'use exactly defaultGroups (array) and groupMeetings (object)',
    defaults: 'defaultGroups must contain unique valid group keys',
    grants: 'grant arrays must contain valid meeting keys',
    json: 'correct malformed JSON in group-meetings.json',
});
const operations = new Set(['configuration', 'bind-secret', 'ca-file', 'connect', 'tls', 'search-bind', 'user-search', 'user-bind', 'groups', 'group-search', 'group-unique-search', 'mapping', 'cleanup']);
const causes = Object.freeze({
    ENOENT: 'file missing', EACCES: 'filesystem access denied', EPERM: 'filesystem access denied',
    ECONNREFUSED: 'connection refused; check LDAP listener/address/port', ECONNRESET: 'connection reset',
    ENOTFOUND: 'hostname not found', EAI_AGAIN: 'temporary DNS failure', ETIMEDOUT: 'operation timed out; check connectivity and configured deadlines',
    ConnectionError: 'LDAP connection failed', TimeoutError: 'LDAP operation timed out',
    InvalidCredentialsError: 'directory rejected bind credentials; check the account and password',
    InsufficientAccessRightsError: 'directory ACL denied the operation; check the restricted search account ACLs',
    NoSuchObjectError: 'search base does not exist; check the configured base DN',
    InvalidDNSyntaxError: 'invalid distinguished name', InvalidSearchFilterError: 'invalid LDAP search filter',
    CERT_HAS_EXPIRED: 'TLS certificate expired', DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is not trusted by the configured CA',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate chain verification failed', ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate hostname mismatch',
    '49': 'directory rejected bind credentials; check the account and password',
    '50': 'directory ACL denied the operation; check search-account ACLs',
    '32': 'configured search base does not exist',
    ELOOP: 'symbolic link is not permitted', EISDIR: 'path is a directory', ENOTDIR: 'path component is not a directory',
});
function diagnostic(code, message = '', extra = {}) {
    const checks = [[/not implemented|Unknown ldap.conf/, 'unsupported'], [/must be exactly true|must be boolean/, 'boolean'], [/positive.*integer|too large/, 'integer'], [/balanced LDAP filter|placeholder/, 'filter'], [/LDAP_TRANSPORT must match/, 'transport'], [/LDAP_URL.*(?:absolute|requires)/, 'url'], [/scope|must be base, one/, 'scope'], [/attribute name/, 'attribute'], [/TLSv1|LDAP_TLS_/, 'tls'], [/is required|nonempty string/, 'required'], [/exactly defaultGroups/, 'structure'], [/defaultGroups must/, 'defaults'], [/Meeting grants|grants must|group key/, 'grants'], [/Cannot load group-meetings.json/, 'json'], [/Group search requires|User-entry groups|LDAP_GROUP_SOURCE/, 'groups']];
    const rule = checks.find(([pattern]) => pattern.test(message))?.[1];
    const setting = (message.match(/\bLDAP_[A-Z_]+\b/) || [])[0];
    return { code: Object.hasOwn(reasons, code) ? code : 'DIRECTORY_UNAVAILABLE', ...(setting ? { setting } : {}), ...(rule ? { rule } : {}), ...extra };
}
function format(d) {
    if (!d || !Object.hasOwn(reasons, d.code)) return null;
    const parts = [reasons[d.code]];
    if (/^LDAP_[A-Z_]{1,60}$/.test(d.setting || '')) parts.push(`setting ${d.setting}`);
    if (Object.hasOwn(rules, d.rule)) parts.push(rules[d.rule]);
    if (operations.has(d.operation)) parts.push(`operation ${d.operation}`);
    if (Object.hasOwn(causes, d.cause)) parts.push(causes[d.cause]);
    // Paths are privileged configuration metadata, JSON-quoted to prevent log injection.
    if (typeof d.file === 'string' && d.file.startsWith('/') && d.file.length <= 4096) parts.push(`file ${JSON.stringify(d.file)}`);
    if (Number.isSafeInteger(d.uid) && d.uid >= 0) parts.push(`owner UID ${d.uid}${d.uid === 0 ? ' (root)' : ''}`);
    if (Number.isInteger(d.mode) && d.mode >= 0 && d.mode <= 0o7777) parts.push(`mode ${d.mode.toString(8).padStart(4, '0')}`);
    return parts.join('; ');
}
module.exports = { diagnostic, format, causes };
