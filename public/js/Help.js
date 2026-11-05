'use strict';

// Read only the shared UI preference; never change the site's selected language.
const helpPrint = document.getElementById('helpPrint');
if (helpPrint) {
    helpPrint.hidden = false;
    helpPrint.addEventListener('click', () => window.print());
}
try {
    const destination = new URL(window.location.href);
    const language = localStorage.getItem('uiLanguageOverride');
    const page = document.documentElement.dataset;
    const available = JSON.parse(page.helpLanguages);
    if (!destination.searchParams.has('lang') && available.includes(language) && language !== page.helpLanguage) {
        destination.pathname = '/help';
        destination.search = '';
        destination.searchParams.set('lang', language);
        window.location.replace(destination.href);
    }
} catch {
    // Storage may be unavailable. Keep the server-selected guide and print button.
}
