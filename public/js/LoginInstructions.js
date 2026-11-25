'use strict';

// One allowlist for initial HTML and browser language changes. No attributes or URLs.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KaigiLoginInstructions = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
    const escape = value => value.replace(/[&<>"']/g, character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    return function loginInstructions(value, purifier) {
        const text = String(value ?? '');
        if (!purifier?.isSupported || typeof purifier.sanitize !== 'function') return escape(text);
        try {
            return purifier.sanitize(text, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'],
                ALLOWED_ATTR: [],
                ALLOW_ARIA_ATTR: false,
                ALLOW_DATA_ATTR: false,
                RETURN_TRUSTED_TYPE: false,
            });
        } catch {
            return escape(text);
        }
    };
});
