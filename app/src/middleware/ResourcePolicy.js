'use strict';

// Keep runtime resources local; embedded images and generated media remain usable.
function buildResourcePolicy(hostUrl) {
    const connections = ["'self'", 'blob:'];
    if (hostUrl) {
        const url = new URL(hostUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid site URL for resource policy');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        connections.push(url.origin);
    }
    return [
        "default-src 'self'",
        // Fabric and locally hosted libraries use dynamic functions; MediaPipe uses WebAssembly.
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "frame-src 'self' blob:",
        `connect-src ${connections.join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
}

function resourcePolicy(hostUrl) {
    const policy = buildResourcePolicy(hostUrl);
    return (_req, res, next) => {
        const existing = res.getHeader('Content-Security-Policy');
        res.setHeader('Content-Security-Policy', existing ? `${existing}; ${policy}` : policy);
        res.setHeader('Permissions-Policy', 'geolocation=()');
        next();
    };
}

module.exports = resourcePolicy;
module.exports.buildResourcePolicy = buildResourcePolicy;
