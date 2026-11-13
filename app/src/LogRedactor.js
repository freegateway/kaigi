'use strict';

const REDACTED = '[REDACTED]';
const sensitiveKey = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|dsn)/i;
const extraSensitiveKey = /^(?:key|pass|passphrase|credentials?|access[_-]?key(?:id)?|stream[_-]?key)$/i;

function redactString(value) {
    return (
        value
            // Remove the entire userinfo, not just the password; usernames can identify accounts.
            .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi, `$1${REDACTED}@`)
            .replace(/([?&])([^=\s&#]+)=([^\s&#]*)/g, (match, separator, key) => {
                try {
                    const decoded = decodeURIComponent(key);
                    if (sensitiveKey.test(decoded) || extraSensitiveKey.test(decoded))
                        return `${separator}${key}=${REDACTED}`;
                } catch {
                    return `${separator}[Malformed parameter]=${REDACTED}`;
                }
                return match;
            })
            .replace(
                /(\b(?:password|passwd|passphrase|secret|token|api[_-]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
                `$1${REDACTED}`
            )
            .replace(/(\b(?:Bearer|Basic)\s+)[a-z0-9._~+\/-]+=*/gi, `$1${REDACTED}`)
    );
}

function redact(value, state = { seen: new WeakSet(), remaining: 2000 }, depth = 0) {
    // Never fall back to an unprocessed value on a traversal boundary.
    if (--state.remaining < 0 || depth > 20) return '[Truncated]';
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function' || typeof value === 'symbol') return '[Omitted]';
    if (value === null || typeof value !== 'object') return value;
    if (state.seen.has(value)) return '[Circular]';
    state.seen.add(value);

    try {
        // Work only with data descriptors: do not invoke getters, toJSON or custom inspectors.
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const output = Array.isArray(value) ? [] : Object.create(null);
        let count = 0;
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (key === 'length' && Array.isArray(value)) continue;
            if (
                !descriptor.enumerable &&
                !(value instanceof Error && ['name', 'message', 'stack', 'cause'].includes(key))
            )
                continue;
            if (++count > 200) {
                if (Array.isArray(output)) Array.prototype.push.call(output, '[Truncated]');
                else output.__truncated = '[Truncated]';
                break;
            }
            const safeKey = redactString(key);
            const next =
                sensitiveKey.test(key) || extraSensitiveKey.test(key)
                    ? REDACTED
                    : Object.hasOwn(descriptor, 'value')
                      ? redact(descriptor.value, state, depth + 1)
                      : '[Accessor omitted]';
            Object.defineProperty(output, safeKey, { value: next, enumerable: true, configurable: true });
        }
        return output;
    } catch {
        return '[Uninspectable]';
    }
}

module.exports = { redact, redactString };
