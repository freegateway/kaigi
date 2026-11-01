'use strict';

// Help navigation only: no application configuration, authentication or media code.
const helpLanguage = document.getElementById('i18nLanguageSelect');
helpLanguage?.addEventListener('change', () => {
    const language = helpLanguage.value;
    if (![...helpLanguage.options].some((option) => option.value === language)) return;
    const destination = new URL('/help', window.location.origin);
    destination.searchParams.set('lang', language);
    destination.hash = window.location.hash;
    window.location.assign(destination.href);
});
