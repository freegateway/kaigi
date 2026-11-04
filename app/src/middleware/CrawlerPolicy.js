'use strict';

// Crawler hints are privacy metadata, never a substitute for authentication.
module.exports = function crawlerPolicy(req, res, next) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/robots.txt') {
        return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    }
    if (req.path === '/sitemap.xml') return res.status(404).end();
    next();
};
