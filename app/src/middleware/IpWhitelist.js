'use strict';

const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('RestrictAccessByIP');

const { enabled = false, allowedIPs = [] } = config?.security?.middleware?.IpWhitelist || {};
const { peerAddress } = require('../SecurityEvents');

const isAllowed = (req) => {
	if (!enabled) return true;
	const clientIP = peerAddress(req);
	if (clientIP !== 'unknown' && allowedIPs.includes(clientIP)) return true;
	log.info('Forbidden: Access denied from this IP address', { clientIP });
	return false;
};

const restrictAccessByIP = (req, res, next) => {
	if (isAllowed(req)) return next();
	return require('../BrowserErrors').sendError(req, res, 403);
};

module.exports = restrictAccessByIP;
module.exports.allowSocketRequest = (req, callback) => callback(null, isAllowed(req));
