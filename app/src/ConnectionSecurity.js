 'use strict';
const { securityEvent } = require('./SecurityEvents');
function seconds(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback * 1000;
    if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 3600) throw new Error(`${name} must be 1..3600 seconds`);
    return Number(value) * 1000;
}
function installConnectionSecurity(server, io, event = securityEvent) {
    const initial = seconds('CONNECTION_INITIAL_TIMEOUT', 15);
    const auth = seconds('SOCKET_AUTH_TIMEOUT', 30);
    const timers = new WeakMap();
    function clear(socket) {
        for (const s of [socket, socket?._parent]) {
            if (s && timers.has(s)) { clearTimeout(timers.get(s)); timers.delete(s); }
        }
    }
    server.headersTimeout = seconds('HTTP_HEADERS_TIMEOUT', 30);
    server.requestTimeout = seconds('HTTP_REQUEST_TIMEOUT', 120);
    server.keepAliveTimeout = seconds('HTTP_KEEPALIVE_TIMEOUT', 5);
    server.timeout = seconds('HTTP_IDLE_TIMEOUT', 30);
    server.on('connection', socket => {
        const timer = setTimeout(() => { timers.delete(socket); event('connection_timeout', socket, 'initial_deadline'); socket.destroy(); }, initial);
        timer.unref?.(); timers.set(socket, timer);
        socket.once('close', () => clear(socket));
    });
    server.on('request', req => clear(req.socket));
    server.on('upgrade', req => { clear(req.socket); req.socket.setTimeout(0); });
    server.on('timeout', socket => { event('connection_timeout', socket, 'http_idle'); socket.destroy(); });
    io.engine.on('connection', connection => {
        const timer = setTimeout(() => { event('authentication_timeout', connection, 'socket_deadline'); connection.close(); }, auth);
        timer.unref?.();
        connection.once('close', () => clearTimeout(timer));
        connection.markAuthenticated = () => clearTimeout(timer);
    });
}
module.exports = { installConnectionSecurity, seconds };
