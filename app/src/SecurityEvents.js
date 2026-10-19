 'use strict';
const { isIP } = require('node:net');
function peerAddress(peer) {
    const value = peer?.remoteAddress || peer?.socket?.remoteAddress || peer?.conn?.remoteAddress || peer?.handshake?.address;
    if (typeof value !== 'string') return 'unknown';
    const ip = value.startsWith('::ffff:') ? value.slice(7) : value;
    return isIP(ip) ? ip : 'unknown';
}
function securityEvent(event, peer, reason = '') {
    // Fixed fields only: never accept credentials, tokens, usernames or arbitrary client text.
    if (!/^[a-z_]+$/.test(event) || !/^[a-z_]*$/.test(reason)) throw new Error('Invalid security event');
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), component: 'conference-security', event, ip: peerAddress(peer), reason }));
}
module.exports = { peerAddress, securityEvent };
