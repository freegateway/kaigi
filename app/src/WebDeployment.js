'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

// Only this module can attach verified proxy attribution to a request.
const verified = new WeakMap();
function address(value) {
    if (typeof value !== 'string') return null;
    const ip = value.startsWith('::ffff:') ? value.slice(7) : value;
    return net.isIP(ip) ? ip : null;
}
function proxyError() {
    const error = new Error('Invalid web deployment configuration');
    error.startupReason = 'proxy';
    return error;
}
function settings(environment = process.env) {
    const mode = environment.WEB_MODE || 'direct';
    if (!['direct', 'proxy'].includes(mode)) throw proxyError();
    let socketPath = environment.WEB_LISTEN_SOCKET || '';
    // A named proxy instance without TCP settings uses its private session socket.
    if (mode === 'proxy' && !socketPath && !environment.WEB_LISTEN_IP &&
        !environment.SERVER_LISTEN_IP && !environment.WEB_LISTEN_PORT &&
        !environment.SERVER_LISTEN_PORT && !environment.WEB_PROXY_IPS) {
        const instance = environment.KAIGI_INSTANCE;
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(instance || '')) throw proxyError();
        socketPath = `/var/run/kaigi/${instance}/session/${instance}.socket`;
    }
    const trusted = (environment.WEB_PROXY_IPS || '').split(',').filter(Boolean);
    const socketMode = environment.WEB_SOCKET_MODE || '0600';
    if (!['0600', '0660'].includes(socketMode)) throw proxyError();
    if (mode === 'direct') {
        if (socketPath || trusted.length || environment.TRUST_PROXY === 'true') throw proxyError();
        return { mode, socketPath: '', trusted: [], socketMode: 0o600 };
    }
    let origin;
    try { origin = new URL(environment.SERVER_HOST_URL || environment.WEB_URL); } catch { throw proxyError(); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw proxyError();
    if (socketPath) {
        if (!path.isAbsolute(socketPath) || path.normalize(socketPath) !== socketPath ||
            Buffer.byteLength(socketPath) > 100 || socketPath.includes('\0') || trusted.length ||
            environment.SERVER_LISTEN_PORT || environment.WEB_LISTEN_PORT ||
            environment.SERVER_LISTEN_IP || environment.WEB_LISTEN_IP) throw proxyError();
    } else {
        if (!trusted.length || trusted.some(ip => !net.isIP(ip) || address(ip) !== ip)) throw proxyError();
        const listenIP = environment.SERVER_LISTEN_IP || environment.WEB_LISTEN_IP;
        if (!net.isIP(listenIP) || listenIP === '0.0.0.0' || listenIP === '::') throw proxyError();
    }
    return { mode, socketPath, trusted, socketMode: parseInt(socketMode, 8), authority: origin.host.toLowerCase() };
}

function validateSocketPath(filename, { allowExisting = true } = {}) {
    let current = path.parse(filename).root;
    for (const part of filename.slice(current.length).split(path.sep)) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw proxyError();
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // The service creates its runtime directory before launch. Preflight can
    // validate a not-yet-created directory without creating application files.
    const parent = path.dirname(filename);
    if (fs.existsSync(parent)) {
        const stat = fs.lstatSync(parent);
        if (!stat.isDirectory() || (stat.mode & 0o022) ||
            (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw proxyError();
    }
    try {
        const stat = fs.lstatSync(filename);
        if (!allowExisting || !stat.isSocket() || (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw proxyError();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function acceptRequest(req, deployment) {
    if (deployment.mode !== 'proxy') return true;
    if (verified.has(req)) return true;
    if (deployment.socketPath && req.socket?.remoteAddress) return false;
    if (!deployment.socketPath && !deployment.trusted.includes(address(req.socket?.remoteAddress))) return false;
    const headers = req.headers;
    const ip = address(headers['x-forwarded-for']);
    // One trusted edge, one overwritten client address. Never parse a chain.
    if (!ip || headers['x-forwarded-for'] !== ip || headers['x-forwarded-proto'] !== 'https' || headers['x-forwarded-prefix'] ||
        typeof headers.host !== 'string' || headers.host.toLowerCase() !== deployment.authority ||
        (headers.origin && headers.origin !== `https://${deployment.authority}`)) return false;
    delete headers.forwarded;
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-prefix'];
    verified.set(req, ip);
    return true;
}

function verifiedAddress(peer) {
    for (const req of [peer, peer?.request, peer?.conn?.request]) {
        if (req && verified.has(req)) return verified.get(req);
    }
    return null;
}

function listenOptions(config) {
    return config.webDeployment?.socketPath ? { path: config.webDeployment.socketPath }
        : { port: Number(config.server.listen.port), host: config.server.listen.ip };
}

function prepareListener(deployment) {
    if (!deployment.socketPath) return;
    validateSocketPath(deployment.socketPath, { allowExisting: false });
    // Restrict permissions from creation, not only after listen succeeds.
    process.umask(process.umask() | 0o077);
}
function listenerReady(deployment) {
    if (!deployment.socketPath) return;
    validateSocketPath(deployment.socketPath);
    fs.chmodSync(deployment.socketPath, deployment.socketMode);
}

module.exports = { settings, acceptRequest, verifiedAddress, validateSocketPath, listenOptions, prepareListener, listenerReady };
