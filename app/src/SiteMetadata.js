'use strict';

const { brandingValues } = require('./Branding');

// Resolve fields independently so localized visible text cannot replace an
// explicitly configured metadata description.
function siteMetadata(settings = {}, dictionaries = {}, language = 'en') {
    const text = { ...dictionaries.en, ...dictionaries[language.split('-')[0]], ...dictionaries[language] };
    const title = text.PAGE_TITLE ?? settings.PAGE_TITLE ?? text.SITE_NAME ?? settings.SITE_NAME ?? brandingValues({}, {}, language).PAGE_TITLE;
    const description =
        text.META_DESCRIPTION ??
        settings.META_DESCRIPTION ??
        text.SITE_DESCRIPTION ??
        settings.SITE_DESCRIPTION ??
        brandingValues({}, {}, language).SITE_DESCRIPTION;
    return {
        PAGE_TITLE: title,
        META_DESCRIPTION: description,
        OG_TITLE: text.OG_TITLE ?? settings.OG_TITLE ?? title,
        OG_DESCRIPTION: text.OG_DESCRIPTION ?? settings.OG_DESCRIPTION ?? description,
    };
}

module.exports = { siteMetadata };
