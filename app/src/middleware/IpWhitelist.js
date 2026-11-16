'use strict';

const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('RestrictAccessByIP');

const { enabled = false, allowedIPs = [] } = config?.security?.middleware?.IpWhitelist || {};
const { peerAddress } = require('../SecurityEvents');

const restrictAccessByIP = (req, res, next) => {
    if (!enabled) return next();
    const clientIP = peerAddress(req);
    log.debug('Check IP', clientIP);
    if (allowedIPs.includes(clientIP)) {
        next();
    } else {
        log.info('Forbidden: Access denied from this IP address', { clientIP: clientIP });
        res.status(403).json({ error: 'Forbidden', message: 'Access denied from this IP address.' });
    }
};

module.exports = restrictAccessByIP;
