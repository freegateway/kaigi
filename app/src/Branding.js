'use strict';
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../../public/lang');
const catalogues = Object.fromEntries(fs.readdirSync(directory).filter(name => name.endsWith('.json'))
	.map(name => [name.slice(0, -5), require(path.join(directory, name)).branding || {}]));
const defaults = Object.freeze({
	SITE_DESCRIPTION: 'Self-hosted video conferencing with authenticated access to authorized meetings.',
	PAGE_TITLE: 'Kaigi - Self-hosted Video Conferencing',
	APP_TAGLINE: 'Self-hosted video conferencing.',
	JOIN_DESCRIPTION: 'Select an authorized meeting to continue.',
	JOIN_BUTTON_LABEL: 'Join meeting',
	CUSTOMIZE_BUTTON_LABEL: 'Customize meeting',
	JOIN_LAST_LABEL: 'Your recent meeting:',
	NEW_ROOM_TITLE: 'Choose a meeting',
	NEW_ROOM_DESCRIPTION: 'Log in and choose a meeting you are authorized to join.',
	LOGIN_HEADING: 'Welcome back',
	LOGIN_INSTRUCTIONS: 'Enter your credentials to continue.',
	LOGIN_BUTTON_LABEL: 'Log in',
});
function brandingValues(settings = {}, translations = {}, language = 'en') {
	const dictionary = { ...catalogues.en, ...catalogues[language.split('-')[0]], ...catalogues[language] };
	const builtin = Object.fromEntries(Object.entries(defaults).map(([key, text]) => [key, dictionary[text] || text]));
	const explicit = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
	const localized = { ...translations.en, ...translations[language.split('-')[0]], ...translations[language] };
	if (Object.hasOwn(localized, 'SITE_DESCRIPTION')) localized.APP_DESCRIPTION = localized.SITE_DESCRIPTION;
	const values = { ...builtin, ...explicit, ...localized };
	if (explicit.SITE_DESCRIPTION !== undefined || Object.hasOwn(localized, 'SITE_DESCRIPTION')) values.APP_TAGLINE = values.SITE_DESCRIPTION;
	return values;
}
module.exports = { brandingValues, defaults, languages: Object.keys(catalogues) };
