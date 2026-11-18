'use strict';
const labels = {
    en: { back: 'Return to sign in', title: { 400: 'Invalid request', 403: 'Access denied', 404: 'Page not found', 500: 'Server error' }, detail: { 400: 'The request could not be understood. Please return to the sign-in page and try again.', 403: 'You do not have permission to access this page.', 404: 'The page you requested does not exist. Use the link below to return to Kaigi.', 500: 'Kaigi could not complete your request. Please try again later.' } },
    ja: { back: 'ログイン画面に戻る', title: { 400: '無効なリクエスト', 403: 'アクセスが拒否されました', 404: 'ページが見つかりません', 500: 'サーバーエラー' }, detail: { 400: 'リクエストを処理できませんでした。ログイン画面に戻り、もう一度お試しください。', 403: 'このページにアクセスする権限がありません。', 404: '指定されたページは存在しません。下のリンクからKaigiに戻ってください。', 500: 'リクエストを完了できませんでした。しばらくしてからもう一度お試しください。' } },
    fr: { back: 'Retour à la connexion', title: { 400: 'Requête non valide', 403: 'Accès refusé', 404: 'Page introuvable', 500: 'Erreur du serveur' }, detail: { 400: 'La requête n’a pas pu être traitée. Retournez à la page de connexion et réessayez.', 403: 'Vous n’avez pas l’autorisation d’accéder à cette page.', 404: 'La page demandée n’existe pas. Utilisez le lien ci-dessous pour retourner à Kaigi.', 500: 'Kaigi n’a pas pu traiter votre requête. Veuillez réessayer plus tard.' } },
};
function language(req) {
    const supported = (process.env.UI_LANGUAGES || 'en-CA,fr-CA,ja,en,fr').split(',').map(s => s.trim());
    const requested = req.acceptsLanguages?.(supported);
    const preferred = requested || process.env.UI_LANGUAGE || 'en-CA';
    const locale = /^(?:en(?:-CA)?|fr(?:-CA)?|ja)$/.test(preferred) ? preferred : 'en-CA';
    const base = locale.split('-')[0];
    return { locale: Object.hasOwn(labels, base) ? locale : 'en-CA', text: labels[base] || labels.en };
}
function browserRequest(req) {
    // API and media endpoints always retain machine-readable errors, even with Accept: text/html.
    return ['GET', 'HEAD'].includes(req.method) && !/^\/(?:api|socket\.io|recSync|auth)(?:\/|$)/.test(req.path || '') && !!req.get('accept')?.includes('text/html') && req.accepts(['html', 'json']) === 'html';
}
function sendError(req, res, status) {
    if (res.headersSent) return res.end();
    const code = [400, 403, 404, 500].includes(status) ? status : 500;
    if (!browserRequest(req)) return res.status(code).json({ status: code, message: labels.en.title[code] });
    const { locale, text } = language(req);
    res.set('Cache-Control', 'no-store');
    res.vary('Accept');
    res.vary('Accept-Language');
    res.set('Content-Language', locale);
    return res.status(code).type('html').send(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kaigi — ${code}</title><link rel="stylesheet" href="/css/errors.css"></head><body><main><p class="brand">Kaigi</p><h1>${code} — ${text.title[code]}</h1><p>${text.detail[code]}</p><a href="/">${text.back}</a></main></body></html>`);
}
module.exports = { sendError, browserRequest };
