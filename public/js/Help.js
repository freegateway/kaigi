'use strict';

// Read only the shared UI preference; never change the site's selected language.
const helpPrint = document.getElementById('helpPrint');
if (helpPrint) {
    helpPrint.hidden = false;
    helpPrint.addEventListener('click', () => window.print());
}
const publicBack =
    document.documentElement.dataset.publicPath === '/security' ? document.getElementById('publicBack') : null;
if (publicBack)
    publicBack.addEventListener('click', (event) => {
        if (
            document.referrer &&
            new URL(document.referrer).origin === window.location.origin &&
            window.history.length > 1
        ) {
            event.preventDefault();
            window.history.back();
        }
    });
try {
    const destination = new URL(window.location.href);
    let stored;
    try {
        stored = localStorage.getItem('uiLanguageOverride');
    } catch {}
    const page = document.documentElement.dataset;
    const available = JSON.parse(page.helpLanguages);
    let language = available.includes(stored) ? stored : 'en';
    if (!available.includes(stored) && typeof navigator !== 'undefined') {
        for (const raw of navigator.languages || [navigator.language]) {
            const tag = String(raw || '').toLowerCase();
            const base = tag.split('-')[0];
            const match =
                available.find((code) => code.toLowerCase() === tag) ||
                available.find((code) => code.toLowerCase() === base) ||
                available.find((code) => code.toLowerCase().split('-')[0] === base);
            if (match) {
                language = match;
                break;
            }
        }
    }
    if (!destination.searchParams.has('lang') && available.includes(language) && language !== page.helpLanguage) {
        destination.pathname = page.publicPath || '/help';
        destination.search = '';
        destination.searchParams.set('lang', language);
        window.location.replace(destination.href);
    }
} catch {
    // Storage may be unavailable. Keep the server-selected guide and print button.
}
