'use strict';

// Shared policies and DOM rendering for all administrator-owned translated text.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KaigiSiteText = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
    const blocks = new Set(['SITE_DESCRIPTION', 'JOIN_DESCRIPTION', 'NEW_ROOM_DESCRIPTION', 'LOGIN_INSTRUCTIONS', 'HELP_LOGIN_INSTRUCTIONS']);
    const metadata = new Set(['PAGE_TITLE', 'META_DESCRIPTION', 'OG_TITLE', 'OG_DESCRIPTION']);
    const tags = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'];
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    function fragment(value, purifier) {
        if (!purifier?.isSupported) return null;
        try {
            return purifier.sanitize(String(value ?? ''), {
                ALLOWED_TAGS: tags, ALLOWED_ATTR: [], ALLOW_ARIA_ATTR: false, ALLOW_DATA_ATTR: false,
                RETURN_DOM_FRAGMENT: true, RETURN_TRUSTED_TYPE: false,
            });
        } catch { return null; }
    }
    function plain(value, purifier) {
        const source = String(value ?? '');
        if (!/[<&]/.test(source)) return source.replace(/\s+/g, ' ').trim();
        const tree = fragment(source, purifier);
        if (!tree) return source;
        for (const node of tree.querySelectorAll('p, br, ul, ol, li')) {
            node.before(tree.ownerDocument.createTextNode(' '));
            node.after(tree.ownerDocument.createTextNode(' '));
        }
        return tree.textContent.replace(/\s+/g, ' ').trim();
    }
    function html(value, key, purifier) {
        if (metadata.has(key)) return escape(plain(value, purifier));
        const tree = fragment(value, purifier);
        if (!tree) return escape(value);
        if (!blocks.has(key)) for (const node of tree.querySelectorAll('p, ul, ol, li')) {
            node.replaceWith(tree.ownerDocument.createTextNode(' '), ...node.childNodes, tree.ownerDocument.createTextNode(' '));
        }
        const container = tree.ownerDocument.createElement('div');
        container.appendChild(tree);
        return container.innerHTML;
    }
    function set(element, value, key, purifier) {
        if (!element || value === undefined) return;
        element.innerHTML = html(value, key, purifier);
        element.setAttribute('data-i18n-skip', '');
        const button = element.closest('button');
        if (button) button.setAttribute('aria-label', plain(value, purifier));
    }
    const fields = {
        siteName: 'SITE_NAME', siteDescription: 'SITE_DESCRIPTION', siteCopyright: 'SITE_COPYRIGHT',
        appDescription: 'SITE_DESCRIPTION', newRoomTitle: 'NEW_ROOM_TITLE', loginNewRoomTitle: 'NEW_ROOM_TITLE',
        newRoomDescription: 'NEW_ROOM_DESCRIPTION', loginNewRoomDescription: 'NEW_ROOM_DESCRIPTION',
        joinDescription: 'JOIN_DESCRIPTION', loginHeading: 'LOGIN_HEADING', loginDescription: 'LOGIN_INSTRUCTIONS',
        loginButtonLabel: 'LOGIN_BUTTON_LABEL', joinRoomLabel: 'JOIN_BUTTON_LABEL', joinSelectRoomLabel: 'JOIN_BUTTON_LABEL',
        customizeRoomLabel: 'CUSTOMIZE_BUTTON_LABEL', joinLastLabel: 'JOIN_LAST_LABEL',
    };
    return { html, plain, set, fields };
});
