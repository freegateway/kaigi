'use strict';

const { JSDOM } = require('jsdom');
const purifier = require('dompurify')(new JSDOM('').window);
const format = require('../../public/js/LoginInstructions');

// Separate instance: do not alter the chat/file sanitizer's settings or hooks.
module.exports = value => format(value, purifier);
