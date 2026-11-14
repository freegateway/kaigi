'use strict';

const express = require('express');

module.exports = function siteAssets(directory) {
    const router = express.Router();
    router.use(express.static(directory, { index: false, redirect: false, dotfiles: 'deny' }));
    // Missing operator assets must not fall through into another site's legacy
    // public/site-assets symlink. Never expose the parent configuration directory.
    router.use((_req, res) => res.sendStatus(404));
    return router;
};
