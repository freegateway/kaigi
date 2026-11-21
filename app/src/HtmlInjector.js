const fs = require('fs');
const { siteMetadata } = require('./SiteMetadata');
const { renderAbout } = require('./AboutContent');

const chokidar = require('chokidar');

const Logger = require('./Logger');

const log = new Logger('HtmlInjector');

class HtmlInjector {
    constructor(filesPath, config) {
        this.filesPath = filesPath; // Array of file paths to cache
        this.cache = {}; // Object to store cached files
        this.config = config; // Configuration containing metadata (OG, title, etc.)
        this.injectData = this.getInjectData(); // Initialize dynamic injection data
        this.watcher = null; // File watcher instance
        this.preloadPages(filesPath); // Preload pages at startup
        this.watchFiles(filesPath); // Watch files for changes
        log.info('filesPath cached', this.filesPath);
    }

    // Function to get dynamic data for injection (e.g., OG data, title, etc.)
    getInjectData(language = this.config?.app?.language || 'en') {
        const config = this.config?.htmlInjection === false ? {} : this.config;
        const metadata = siteMetadata({
            PAGE_TITLE: config?.site?.title,
            META_DESCRIPTION: config?.meta?.description,
            OG_TITLE: config?.og?.title,
            OG_DESCRIPTION: config?.og?.description,
            SITE_NAME: config?.site?.name || undefined,
            SITE_DESCRIPTION: config?.site?.description || undefined,
        }, {}, language);
        const localized = config?.metadataByLanguage?.[language] || config?.metadataByLanguage?.[language.split('-')[0]];
        const values = config?.brandingByLanguage?.[language] || config?.brandingByLanguage?.en || {};
        return {
            ...metadata, ...localized,
            APP_NAME: values.SITE_NAME ?? config?.app?.name ?? 'Kaigi',
            OG_TYPE: config?.og?.type || 'app-webrtc',
            OG_SITE_NAME: values.SITE_NAME ?? config?.og?.siteName ?? 'Kaigi',
            OG_IMAGE: config?.og?.image || '/images/logo.svg',
            OG_URL: config?.og?.url || '/',
            // Add more data here as needed with fallbacks
        };
    }

    // Function to load a file into the cache
    loadFileToCache(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.cache[filePath] = content; // Store the content in cache
        } catch (err) {
            log.error(`Error reading file: ${filePath}`, err);
        }
    }

    // Function to preload pages into the cache
    preloadPages(filePaths) {
        filePaths.forEach((filePath) => this.loadFileToCache(filePath));
    }

    // Function to watch files for changes using chokidar
    watchFiles(filePaths) {
        if (this.watcher) {
            this.watcher.close(); // Close existing watcher if any
        }

        this.watcher = chokidar.watch(filePaths, {
            persistent: true,
            ignoreInitial: true, // Ignore initial 'add' events
        });

        this.watcher
            .on('change', (filePath) => {
                log.debug(`File changed: ${filePath}`);
                this.loadFileToCache(filePath);
                log.debug(`Reloaded file ${filePath} into cache`);
            })
            .on('error', (error) => {
                log.error(`Watcher error: ${error.message}`);
            });
    }

    // Function to inject dynamic data (e.g., OG, TITLE, etc.) into a given file
    injectHtml(filePath, res, context = {}) {
        let html = this.cache[filePath];
        if (!html) {
            log.error(`File not cached: ${filePath}`);
            if (!res.headersSent) {
                return res.status(500).send('Server Error');
            }
            return;
        }

        try {
            const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
            const available = this.config?.app?.languages || require('./Branding').languages;
            const language = res.req ? require('./Locale').requestLanguage(res.req, available) : this.config?.app?.language || 'en';
            const data = this.getInjectData(language);
            res.vary?.('Accept-Language');
            res.set?.('Content-Language', language);
            html = html.replace(/<html\b[^>]*>/i, open => open.replace(/\s+lang=["'][^"']*["']/i, '').replace('>', ` lang="${escape(language)}">`));
            const values = this.config?.htmlInjection === false ? require('./Branding').brandingValues({}, {}, language) :
                this.config?.brandingByLanguage?.[language] || this.config?.brandingByLanguage?.en;
            if (values) {
                const fields = { appDescription: 'SITE_DESCRIPTION', newRoomTitle: 'NEW_ROOM_TITLE', loginNewRoomTitle: 'NEW_ROOM_TITLE',
                    newRoomDescription: 'NEW_ROOM_DESCRIPTION', loginNewRoomDescription: 'NEW_ROOM_DESCRIPTION',
                    loginHeading: 'LOGIN_HEADING', loginDescription: 'LOGIN_INSTRUCTIONS', loginBtnText: 'LOGIN_BUTTON_LABEL' };
                for (const [id, key] of Object.entries(fields)) {
                    const pattern = new RegExp(`(<(p|h[1-6]|span)[^>]*\\bid=["']${id}["'][^>]*>)([\\s\\S]*?)(</\\2>)`);
                    html = html.replace(pattern, (_, open, tag, content, close) => {
                        const icon = id === 'loginBtnText' ? content.match(/<i\b[^>]*>[\s\S]*?<\/i>/)?.[0] || '' : '';
                        return open.replace(/>$/, ' data-i18n-skip>') + icon + escape(key === 'SITE_DESCRIPTION' ? values.APP_DESCRIPTION ?? values[key] : values[key]) + close;
                    });
                }
            }
            if (values && values.APP_TITLE === undefined) {
                html = html.replace(/(<h1\b[^>]*\bid=["']appTitle["'][^>]*>)[\s\S]*?<\/h1>/,
                    (_, open) => open.replace(/>$/, ' data-i18n-skip>') + escape(values.SITE_NAME ?? data.APP_NAME) + '<br />' +
                        escape(values.APP_TAGLINE) + '</h1>');
            }
            html = html.replaceAll('{{KAIGI_ABOUT}}', () => renderAbout(this.config?.site?.sourceCodeUrl));
            html = html.replace(/{{(APP_NAME|OG_[A-Z_]+)}}/g, (_, key) => escape(data[key]));
            // Only rewrite metadata inside the trusted template's head. Cached
            // templates remain unchanged; no request fields enter public previews.
            html = html.replace(/<head>([\s\S]*?)<\/head>/i, (_, head) => {
                head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i,
                    () => `<title id="title" data-site-title>${escape(data.PAGE_TITLE)}</title>`);
                const tags = [
                    ['name', 'description', data.META_DESCRIPTION],
                    ['property', 'og:type', data.OG_TYPE], ['property', 'og:site_name', data.OG_SITE_NAME],
                    ['property', 'og:title', data.OG_TITLE], ['property', 'og:description', data.OG_DESCRIPTION],
                    ['property', 'og:image', data.OG_IMAGE], ['property', 'og:url', data.OG_URL],
                    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', data.OG_TITLE],
                    ['name', 'twitter:description', data.OG_DESCRIPTION], ['name', 'twitter:image', data.OG_IMAGE],
                ];
                for (const [attribute, key, value] of tags) {
                    const pattern = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${key}["'])[^>]*>`, 'gi');
                    head = head.replace(pattern, '');
                    head += `\n<meta ${attribute}="${key}"${key === 'description' ? ' id="description"' : ''} content="${escape(value)}" />`;
                }
                return `<head>${head}\n</head>`;
            });
            // Request data must never be interpreted as a template placeholder.
            if (context.meeting) {
                const meeting = JSON.stringify({ meeting: context.meeting }).replace(/</g, '\\u003c');
                html = html.replace('</head>', () => `<script type="application/json" id="authorizedMeeting">${meeting}</script></head>`);
            }
            if (!res.headersSent) {
                res.send(html);
            }
        } catch (error) {
            log.error('Error injecting HTML data:', error);
            if (!res.headersSent) {
                res.status(500).send('Server Error');
            }
        }
    }

    // Cleanup watcher when the instance is no longer needed
    cleanup() {
        if (this.watcher) {
            this.watcher.close();
        }
    }
}

module.exports = HtmlInjector;
