'use strict';

const defaultTitle = 'Kaigi - Self-hosted Video Conferencing';
const defaultDescription = 'Self-hosted video conferencing with authenticated access to authorized meetings.';

// Resolve fields independently so localized visible text cannot replace an
// explicitly configured metadata description.
function siteMetadata(settings = {}, dictionaries = {}, language = 'en') {
    const text = { ...dictionaries.en, ...dictionaries[language.split('-')[0]], ...dictionaries[language] };
    const title = text.PAGE_TITLE ?? settings.PAGE_TITLE ?? text.SITE_NAME ?? settings.SITE_NAME ?? defaultTitle;
    const description =
        text.META_DESCRIPTION ??
        settings.META_DESCRIPTION ??
        text.SITE_DESCRIPTION ??
        settings.SITE_DESCRIPTION ??
        defaultDescription;
    return {
        PAGE_TITLE: title,
        META_DESCRIPTION: description,
        OG_TITLE: text.OG_TITLE ?? settings.OG_TITLE ?? title,
        OG_DESCRIPTION: text.OG_DESCRIPTION ?? settings.OG_DESCRIPTION ?? description,
    };
}

module.exports = { siteMetadata };
