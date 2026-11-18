'use strict';
function avatarURL(value, origin) {
    if (typeof value !== 'string' || value.length > 2048 || !origin) return false;
    try {
        const base = new URL(origin), url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return false;
        return url.href;
    } catch { return false; }
}
module.exports = { avatarURL };
