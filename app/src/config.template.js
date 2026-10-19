'use strict';

/**
 * ==============================================
 * MiroTalk SFU v2.6.48 - Configuration File
 * ==============================================
 *
 * This file contains all configurable settings for the MiroTalk SFU application.
 * Environment variables can override most settings (see each section for details).
 *
 * Structure:
 * 1. Core System Configuration
 * 2. Server Settings
 * 3. Media Handling
 * 4. Security & Authentication
 * 5. API Configuration
 * 6. Third-Party Integrations
 * 7. UI/UX Customization
 * 8. Feature Flags
 * 9. Mediasoup (WebRTC) Settings
 */

const os = require('os');
const fs = require('fs');
const splitChar = ',';
// Kaigi owns a separate configuration namespace from upstream MiroTalk.
const configDirectory = process.env.KAIGI_CONFIG_DIR || '/usr/local/etc/kaigi';
const sourceCodeUrl = process.env.KAIGI_SOURCE_URL || 'https://github.com/freegateway/kaigi';

const loadFreeBSDConfig = (configPath = require('path').join(configDirectory, 'kaigi.conf'), requiredFile = false) => {

    if (!fs.existsSync(configPath)) {
        if (requiredFile) throw new Error(`Required configuration file is missing: ${configPath}`);
        return Object.create(null);
    }

    const values = new Map();

    for (const [lineNumber, sourceLine] of fs.readFileSync(configPath, 'utf8').split(/\r?\n/).entries()) {
        const line = sourceLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        const separator = line.indexOf('=');
        if (separator < 1) {
            throw new Error(`Invalid kaigi.conf entry at line ${lineNumber + 1}`);
        }

        const name = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            throw new Error(`Invalid kaigi.conf variable name at line ${lineNumber + 1}: ${name}`);
        }

        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }

        if (requiredFile && values.has(name)) throw new Error(`Duplicate LDAP configuration setting: ${name}`);
        values.set(name, value);
    }

    const resolved = new Map();
    const resolving = new Set();

    const resolve = (name) => {
        if (resolved.has(name)) {
            return resolved.get(name);
        }
        if (!values.has(name)) {
            throw new Error(`Undefined kaigi.conf variable referenced: ${name}`);
        }
        if (resolving.has(name)) {
            throw new Error(`Circular kaigi.conf variable reference involving: ${name}`);
        }

        resolving.add(name);
        const value = values.get(name).replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, referencedName) => resolve(referencedName));
        resolving.delete(name);
        resolved.set(name, value);
        return value;
    };

    const config = Object.create(null);
    for (const name of values.keys()) {
        config[name] = resolve(name);
    }
    return config;
};

const freeBSDConfig = loadFreeBSDConfig();
const ldapCompiled = true;
for (const name of Object.keys(freeBSDConfig)) {
    if (name.startsWith('LDAP_') && name !== 'LDAP_ENABLED') throw new Error(`${name} belongs in ${configDirectory}/ldap/ldap.conf`);
}
if (freeBSDConfig.LDAP_ENABLED !== undefined && !['true', 'false'].includes(freeBSDConfig.LDAP_ENABLED)) throw new Error('LDAP_ENABLED must be true or false');
let ldapSettings = { enabled: false };
if (freeBSDConfig.LDAP_ENABLED === 'true') {
    if (!ldapCompiled) throw new Error('LDAP_ENABLED=true requires LDAP support');
    const ldapValues = loadFreeBSDConfig(require('path').join(configDirectory, 'ldap/ldap.conf'), true);
    if (Object.hasOwn(ldapValues, 'LDAP_ENABLED')) throw new Error('LDAP_ENABLED belongs only in kaigi.conf');
    for (const name of Object.keys(ldapValues)) if (!name.startsWith('LDAP_')) throw new Error(`Invalid LDAP configuration setting: ${name}`);
    ldapSettings = require('./LdapAuth.cjs').ldapConfig({ ...ldapValues, LDAP_ENABLED: 'true' }, require('path').join(configDirectory, 'ldap/group-meetings.json'));
}

// Administrator-owned public text only; never publish the deployment config.
const siteTextSettings = Object.freeze(["SITE_NAME", "SITE_DESCRIPTION", "SITE_COPYRIGHT", "PAGE_TITLE", "JOIN_DESCRIPTION", "JOIN_BUTTON_LABEL", "CUSTOMIZE_BUTTON_LABEL", "JOIN_LAST_LABEL", "NEW_ROOM_TITLE", "NEW_ROOM_DESCRIPTION", "LOGIN_HEADING", "LOGIN_INSTRUCTIONS", "LOGIN_BUTTON_LABEL"]);
const siteTranslationsPath = require('path').join(configDirectory, 'site-translations.json');
const loadSiteTranslations = () => {
    let source;
    try { source = fs.readFileSync(siteTranslationsPath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`Cannot read site translation file ${siteTranslationsPath} (${error.code}).`); }
    if (require('node:buffer').Buffer.byteLength(source, 'utf8') > 262144) throw new Error(`Site translation file ${siteTranslationsPath} exceeds 256 KiB.`);
    let data;
    try { data = JSON.parse(source); } catch { throw new Error(`Site translation file ${siteTranslationsPath} is not valid JSON.`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Site translations must be an object keyed by language code.');
    const result = Object.create(null);
    for (const [language, entries] of Object.entries(data)) {
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Invalid site translation language entry: ${language}`);
        result[language] = Object.create(null);
        for (const [name, value] of Object.entries(entries)) {
            if (!siteTextSettings.includes(name)) throw new Error(`Unsupported site translation setting: ${name}`);
            if (typeof value !== 'string' || value.includes('\0') || value.length > 8192) throw new Error(`Site translation ${language}.${name} must be text without NUL, at most 8192 characters.`);
            result[language][name] = value;
        }
    }
    return result;
};
const siteTranslations = loadSiteTranslations();
const meetingSettings = require('./MeetingSettings').loadMeetingSettings(configDirectory);
// English supplies startup text; the browser applies the selected language.
// Configured text and application defaults cover missing translations.
for (const [name, value] of Object.entries(siteTranslations.en || {})) {
    const target = name === 'PAGE_TITLE' ? 'SITE_TITLE' : name === 'NEW_ROOM_DESCRIPTION' ? 'NEW_ROOM_DESC' : name;
    if (process.env[target] === undefined && freeBSDConfig[name] === undefined) process.env[target] = value;
}

// FreeBSD-facing names are translated once into MiroTalk's existing
// environment-variable configuration interface.  Existing environment values
// always win, so kaigi.conf is an override layer above upstream defaults,
// not a replacement for them.
if (freeBSDConfig.MEDIA_LISTEN_IP === undefined && freeBSDConfig.WEB_LISTEN_IP !== undefined) {
    freeBSDConfig.MEDIA_LISTEN_IP = freeBSDConfig.WEB_LISTEN_IP;
}

if (freeBSDConfig.WEB_URL === undefined && freeBSDConfig.WEB_LISTEN_HOST) {
    const webListenPort = freeBSDConfig.WEB_LISTEN_PORT || '3010';
    freeBSDConfig.WEB_URL = `https://${freeBSDConfig.WEB_LISTEN_HOST}:${webListenPort}`;
}

if (freeBSDConfig.MEDIA_ANNOUNCED_HOST && freeBSDConfig.MEDIA_ANNOUNCED_IP) {
    throw new Error('MEDIA_ANNOUNCED_HOST and MEDIA_ANNOUNCED_IP are mutually exclusive');
}

const siteAssetUrl = (name) => (name ? `/site-assets/${name}` : '');
const aliases = {
    PAGE_TITLE: 'SITE_TITLE',
    SITE_ICON_NAME: 'SITE_ICON_PATH',
    APPLE_TOUCH_ICON_NAME: 'APPLE_TOUCH_ICON_PATH',
    ABOUT_IMAGE_NAME: 'ABOUT_IMAGE_URL',
    NEW_ROOM_DESCRIPTION: 'NEW_ROOM_DESC',
    WEB_LISTEN_IP: 'SERVER_LISTEN_IP',
    WEB_LISTEN_PORT: 'SERVER_LISTEN_PORT',
    WEB_URL: 'SERVER_HOST_URL',
    WEB_SSL_CERT: 'SERVER_SSL_CERT',
    WEB_SSL_KEY: 'SERVER_SSL_KEY',
    MEDIA_LISTEN_IP: 'SFU_LISTEN_IP',
    MEDIA_ANNOUNCED_IP: 'SFU_ANNOUNCED_IP',
    MEDIA_MIN_PORT: 'SFU_MIN_PORT',
    MEDIA_MAX_PORT: 'SFU_MAX_PORT',
    MEDIA_NUM_WORKERS: 'SFU_NUM_WORKERS',
};

const assetAliases = {
    SITE_ICON_NAME: 'SITE_ICON_PATH',
    APPLE_TOUCH_ICON_NAME: 'APPLE_TOUCH_ICON_PATH',
    ABOUT_IMAGE_NAME: 'ABOUT_IMAGE_URL',
};

for (const [name, value] of Object.entries(freeBSDConfig)) {
    if (name.startsWith('LDAP_')) continue;
    const target = aliases[name] || name;
    const mappedValue = assetAliases[name] ? siteAssetUrl(value) : value;

    if (process.env[target] === undefined) {
        process.env[target] = mappedValue;
    }
}

// Site identity is a FreeBSD convenience layer.  Populate the corresponding
// upstream branding variables only when they were not explicitly supplied.
const setDefaultEnvironment = (name, value) => {
    if (value && process.env[name] === undefined) {
        process.env[name] = value;
    }
};

setDefaultEnvironment('APP_NAME', process.env.SITE_NAME);
if (process.env.SITE_NAME && process.env.APP_TITLE === undefined) {
    process.env.APP_TITLE = `<h1>${process.env.SITE_NAME}</h1>${process.env.SITE_DESCRIPTION || ''}`;
}
setDefaultEnvironment('APP_DESCRIPTION', process.env.SITE_DESCRIPTION);
setDefaultEnvironment('SITE_TITLE', process.env.SITE_NAME);
setDefaultEnvironment('META_DESCRIPTION', process.env.SITE_DESCRIPTION);
setDefaultEnvironment('OG_SITE_NAME', process.env.SITE_NAME);
setDefaultEnvironment('OG_TITLE', process.env.SITE_NAME);
setDefaultEnvironment('OG_DESCRIPTION', process.env.SITE_DESCRIPTION);
setDefaultEnvironment('OG_URL', process.env.SITE_URL);

const parseNonNegativeSeconds = (name, fallback) => {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value)) {
        throw new Error(`${name} must be a non-negative integer number of seconds`);
    }
    return Number.parseInt(value, 10);
};

const authIdleTimeout = parseNonNegativeSeconds('AUTH_IDLE_TIMEOUT', 1800);
const authSessionMaxAge = parseNonNegativeSeconds('AUTH_SESSION_MAX_AGE', 28800);

// Keep these codes in sync with LANG_DISPLAY in public/js/I18n.js.
const supportedUILanguages = Object.freeze([
    'en', 'en-CA', 'hu', 'es', 'fr', 'fr-CA', 'de', 'pt', 'it', 'ru',
    'zh', 'ja', 'ar', 'hi', 'sr', 'id', 'ko', 'tr', 'nl',
]);

const validateUILanguage = (name, code) => {
    if (!supportedUILanguages.includes(code)) {
        throw new Error(`Unsupported ${name} code: ${code || '(empty)'}; supported codes: ${supportedUILanguages.join(', ')}`);
    }
};

if (process.env.UI_LANGUAGE !== undefined) {
    validateUILanguage('UI_LANGUAGE', process.env.UI_LANGUAGE);
}

if (process.env.UI_LANGUAGES) {
    const codes = process.env.UI_LANGUAGES.split(',').map((code) => code.trim());
    for (const code of codes) validateUILanguage('UI_LANGUAGES', code);
}

const packageJson = require('../../package.json');

// ==============================================
// 1. Environment Detection & System Configuration
// ==============================================

const PLATFORM = os.platform();
const IS_DOCKER = fs.existsSync('/.dockerenv');
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const WEB_LISTEN_IP = process.env.SERVER_LISTEN_IP || '0.0.0.0';
const ANNOUNCED_IP = process.env.SFU_ANNOUNCED_IP || '';
const LISTEN_IP = process.env.SFU_LISTEN_IP || WEB_LISTEN_IP;
const IPv4 = getIPv4();

// ==============================================
// 2. WebRTC Port Configuration
// ==============================================

const RTC_MIN_PORT = parseInt(process.env.SFU_MIN_PORT) || 40000;
const RTC_MAX_PORT = parseInt(process.env.SFU_MAX_PORT) || 40100;
const NUM_CPUS = os.cpus().length;
const NUM_WORKERS = Math.min(process.env.SFU_NUM_WORKERS || NUM_CPUS, NUM_CPUS);

// ==============================================
// 3. FFmpeg Path Configuration
// ==============================================

const RTMP_FFMPEG_PATH = process.env.RTMP_FFMPEG_PATH || getFFmpegPath(PLATFORM);

// ==============================================
// Main Configuration Export
// ==============================================

module.exports = {
    meetingRestrictions: meetingSettings.restrictions,
    meetingTranslations: meetingSettings.translations,
    // ==============================================
    // 1. Core System Configuration
    // ==============================================

    system: {
        /**
         * System Information
         * ------------------
         * - Hardware/OS details collected automatically
         * - Used for diagnostics and optimization
         */
        info: {
            environment: ENVIRONMENT,
            os: {
                type: os.type(),
                release: os.release(),
                arch: os.arch(),
            },
            cpu: {
                cores: NUM_CPUS,
                model: os.cpus()[0].model,
            },
            memory: {
                total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            },
            isDocker: IS_DOCKER,
        },

        /**
         * Console Configuration
         * ---------------------
         * - timeZone: IANA timezone (e.g., 'Europe/Rome')
         * - debug: Enable debug logging in non-production
         * - colors: Colorized console output
         * - json: Log output in JSON format
         * - json_pretty: Pretty-print JSON logs
         */
        console: {
            timeZone: 'UTC',
            debug: ENVIRONMENT !== 'production',
            json: process.env.LOGS_JSON === 'true',
            json_pretty: process.env.LOGS_JSON_PRETTY === 'true',
            colors: process.env.LOGS_JSON === 'true' ? false : true,
        },
    },

    // ==============================================
    // 2. Server Configuration
    // ==============================================

    server: {
        /**
         * Host Configuration
         * ------------------
         * - hostUrl: Public URL (e.g., 'https://yourdomain.com')
         * - listen: IP and port to bind to
         */
        hostUrl: process.env.SERVER_HOST_URL || 'https://localhost:3010',
        listen: {
            ip: WEB_LISTEN_IP,
            port: process.env.SERVER_LISTEN_PORT || 3010,
        },

        /**
         * Security Settings
         * -----------------
         * - trustProxy: Trust X-Forwarded-* headers
         * - ssl: SSL certificate paths
         * - cors: Cross-origin resource sharing
         */
        trustProxy: process.env.TRUST_PROXY === 'true',
        ssl: {
            cert: process.env.SERVER_SSL_CERT || '../ssl/cert.pem',
            key: process.env.SERVER_SSL_KEY || '../ssl/key.pem',
        },
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST'],
        },

        /**
         * Embed (iframe) Restrictions
         * ---------------------------
         * Controls which origins are allowed to embed MiroTalk SFU in an <iframe>
         * via the HTTP `Content-Security-Policy: frame-ancestors` header
         * (also mirrored to `X-Frame-Options` when possible for legacy browsers).
         *
         * Behavior:
         * - Empty / unset  → header NOT set, embedding allowed anywhere (default).
         * - 'none'         → block ALL embedding (frame-ancestors 'none' + X-Frame-Options: DENY).
         * - 'self'         → only same-origin embedding (frame-ancestors 'self' + X-Frame-Options: SAMEORIGIN).
         * - list           → comma-separated origins, 'self' is always implicitly included.
         *                    Wildcards like https://*.example.com are valid in CSP.
         *
         * IMPORTANT: This affects the widget too — the MiroTalk widget embeds
         * the room in an iframe on the host site, so every site that should
         * load the widget must be listed here.
         */
        embed: {
            allowedOrigins: process.env.ALLOWED_EMBED_ORIGINS
                ? process.env.ALLOWED_EMBED_ORIGINS.split(',')
                      .map((o) => o.trim())
                      .filter(Boolean)
                : [],
        },
    },

    // ==============================================
    // 3. Media Handling Configuration
    // ==============================================

    media: {
        /**
         * Recording Configuration
         * =======================
         * Server side recording functionality.
         *
         * Core Settings:
         * ------------------------
         * - enabled        : Enable recording functionality
         * - uploadToS3     : Fixed to false in HARDENED; cloud uploads are disabled.
         * - endpoint       : Leave empty ('') to store recordings locally OR
         *   - Set to a valid URL (e.g., 'http://localhost:8080/') to:
         *      - Push recordings to a remote server
         *      - Store in cloud storage services
         *      - Send to processing pipelines
         * - dir            : Storage directory for recordings (Relative to app/src/ default: app/rec)
         * - maxFileSize    : Maximum recording size (1GB default)
         *
         * Upload Security:
         * ------------------------
         * - uploadTokenExp : Lifetime of the per-session upload token issued on join and
         *                    required by the /recSync* endpoints (default '24h'). Must be
         *                    long enough to outlast the longest expected recording.
         * - rateLimit      : Per-IP rate limit for /recSync* upload requests
         *                    (default: 300 requests / 60s) to mitigate flooding.
         *
         * Docker Note:
         * ------------
         * - When running in Docker, ensure the recording directory exists and is properly mounted:
         *   1. Create the directory (e.g., 'app/rec')
         *   2. Configure as volume in docker-compose.yml
         *   3. Set appropriate permissions
         *   4. Restart container after changes
         */
        recording: {
            enabled: process.env.RECORDING_ENABLED === 'true',
            uploadToS3: false,
            endpoint: process.env.RECORDING_ENDPOINT || '',
            dir: process.env.RECORDING_DIR || '../rec',
            maxFileSize: process.env.RECORDING_MAX_FILE_SIZE || 1 * 1024 * 1024 * 1024, // 1GB
            uploadTokenExp: process.env.RECORDING_UPLOAD_TOKEN_EXP || '24h',
            rateLimit: {
                windowMs: parseInt(process.env.RECORDING_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
                max: parseInt(process.env.RECORDING_RATE_LIMIT_MAX) || 300,
            },
        },

        // RTMP streaming is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        rtmp: {
            enabled: false,
            fromFile: process.env.RTMP_FROM_FILE !== 'false',
            fromUrl: process.env.RTMP_FROM_URL !== 'false',
            fromStream: process.env.RTMP_FROM_STREAM !== 'false',
            maxStreams: parseInt(process.env.RTMP_MAX_STREAMS) || 1,
            allowCustomUrl: process.env.RTMP_ALLOW_CUSTOM_URL === 'true',
            useNodeMediaServer: process.env.RTMP_USE_NODE_MEDIA_SERVER !== 'false',
            server: process.env.RTMP_SERVER || 'rtmp://localhost:1935',
            appName: process.env.RTMP_APP_NAME || 'live',
            streamKey: process.env.RTMP_STREAM_KEY || '',
            secret: process.env.RTMP_SECRET || 'mirotalkRtmpSecret',
            apiSecret: process.env.RTMP_API_SECRET || '',
            expirationHours: parseInt(process.env.RTMP_EXPIRATION_HOURS) || 4,
            dir: process.env.RTMP_DIR || '../rtmp',
            ffmpegPath: RTMP_FFMPEG_PATH,
            platform: PLATFORM,
            videoQuality: process.env.RTMP_VIDEO_QUALITY || '720p',
            maxVideoQuality: process.env.RTMP_MAX_VIDEO_QUALITY || '1080p',
            allowQualitySelection: process.env.RTMP_ALLOW_QUALITY_SELECTION !== 'false',
            videoBitrate: parseInt(process.env.RTMP_VIDEO_BITRATE) || 0,
            videoFps: parseInt(process.env.RTMP_VIDEO_FPS) || 30,
            videoPreset: process.env.RTMP_VIDEO_PRESET || 'veryfast',
            audioBitrate: parseInt(process.env.RTMP_AUDIO_BITRATE) || 128,
        },
    },

    // ==============================================
    // 4. Security & Authentication
    // ==============================================

    security: {
        /**
         * IP Whitelisting
         * ------------------------
         * - enabled: Restrict access to specified IPs
         * - allowedIPs: Array of permitted IP addresses
         */
        middleware: {
            IpWhitelist: {
                enabled: process.env.IP_WHITELIST_ENABLED === 'true',
                allowedIPs: process.env.IP_WHITELIST_ALLOWED
                    ? process.env.IP_WHITELIST_ALLOWED.split(splitChar)
                          .map((ip) => ip.trim())
                          .filter((ip) => ip !== '')
                    : ['127.0.0.1', '::1'],
            },
        },

        /**
         * JWT Configuration
         * ------------------------
         * - key: Secret for JWT signing (required, min 32 chars, e.g. `openssl rand -hex 32`).
         *        The server refuses to start if it is missing, weak or a published default.
         * - exp: Token expiration time
         */
        jwt: {
            key: (() => {
                const secret = process.env.JWT_SECRET;

                delete process.env.JWT_SECRET;

                return secret;
            })(),
            exp:
                process.env.JWT_EXPIRATION ||
                (authSessionMaxAge > 0 ? `${authSessionMaxAge}s` : false),
        },

        /**
         * Local authenticated-session lifetime.
         *
         * idleTimeout is refreshed by meaningful browser activity.  While a
         * participant is connected to an active meeting, the authenticated
         * browser sends a heartbeat so quiet participation counts as activity.
         * maxAge is absolute and is never extended by activity.  Zero disables
         * the corresponding limit.
         */
        ldap: ldapSettings,
        authSession: {
            idleTimeout: authIdleTimeout,
            maxAge: authSessionMaxAge,
        },

        /**
         * OpenID Connect (OIDC) Authentication Configuration
         * =================================================
         * Configures authentication using OpenID Connect (OIDC), allowing integration with
         * identity providers like Auth0, Okta, Keycloak, etc.
         *
         * Structure:
         * - enabled                                : Master switch for OIDC authentication
         * - baseURLDynamic                         : Whether to dynamically resolve base URL
         *   allow_rooms_creation_for_auth_users    : Allow all authenticated users via OIDC to create their own rooms
         * - peer_name                              : Controls which user attributes to enforce/request
         * - config                                 : Core OIDC provider settings
         *
         * Core Settings:
         * - issuerBaseURL      : Provider's discovery endpoint (e.g., https://your-tenant.auth0.com)
         * - baseURL            : Your application's base URL
         * - clientID           : Client identifier issued by provider
         * - clientSecret       : Client secret issued by provider
         * - secret             : Application session secret
         * - authRequired       : Whether all routes require authentication
         * - auth0Logout        : Whether to use provider's logout endpoint
         * - authorizationParams: OAuth/OIDC flow parameters including:
         *   - response_type    : OAuth response type ('code' for Authorization Code Flow)
         *   - scope            : Requested claims (openid, profile, email)
         * - routes             : Endpoint path configuration for:
         *   - callback         : OAuth callback handler path
         *   - login            : Custom login path (false to disable)
         *   - logout           : Custom logout path
         *
         */
        oidc: {
            enabled: process.env.OIDC_ENABLED === 'true',
            baseURLDynamic: process.env.OIDC_BASE_URL_DYNAMIC === 'true', // Set true if your app has dynamic base URLs

            /*
             * When `baseURLDynamic` is true, the OIDC baseURL (and therefore the redirect_uri
             * sent to the IdP) is derived from the incoming `Host` header. To prevent
             * Host-header injection from redirecting authorization codes to an attacker,
             * list every origin the server is allowed to serve here (full origin, no path).
             * The static `config.baseURL` is always trusted and does not need to be repeated.
             * Example: ['https://meet.example.com', 'https://meet.eu.example.com']
             */
            allowedDynamicBaseURLs: process.env.OIDC_ALLOWED_DYNAMIC_BASE_URLS
                ? process.env.OIDC_ALLOWED_DYNAMIC_BASE_URLS.split(splitChar)
                      .map((u) => u.trim())
                      .filter(Boolean)
                : [],

            // ==================================================================================================
            allow_rooms_creation_for_auth_users: process.env.OIDC_ALLOW_ROOMS_CREATION_FOR_AUTH_USERS !== 'false',
            // ==================================================================================================

            // User identity requirements
            peer_name: {
                force: process.env.OIDC_USERNAME_FORCE !== 'false', // Forces the username to match the OIDC email or name. If true, the user won't be able to change their name when joining a room
                email: process.env.OIDC_USERNAME_AS_EMAIL !== 'false', // Uses the OIDC email as the username.
                name: process.env.OIDC_USERNAME_AS_NAME === 'true', // Uses the OIDC name as the username
            },

            // Provider configuration
            config: {
                // Required provider settings
                issuerBaseURL: process.env.OIDC_ISSUER || 'https://server.example.com',
                baseURL: process.env.OIDC_BASE_URL || `http://localhost:${process.env.PORT || 3010}`,
                clientID: process.env.OIDC_CLIENT_ID || 'clientID',
                clientSecret: process.env.OIDC_CLIENT_SECRET || 'clientSecret',

                // Session configuration
                secret: process.env.OIDC_SECRET || 'mirotalksfu-oidc-secret',
                authRequired: process.env.OIDC_AUTH_REQUIRED === 'true', // Whether all routes require authentication
                auth0Logout: process.env.OIDC_AUTH_LOGOUT !== 'false', // Use provider's logout endpoint

                // OAuth/OIDC flow parameters
                authorizationParams: {
                    response_type: 'code', // Use authorization code flow
                    scope: 'openid profile email', // Request standard claims
                },

                // Route customization
                routes: {
                    callback: '/auth/callback', // OAuth callback path
                    login: false, // Disable default login route
                    logout: '/logout', // Custom logout path
                },
            },
        },

        /**
         * Host Protection Configuration
         * ============================
         * Controls access to host-level functionality and room management.
         *
         * Authentication Methods:
         * ----------------------
         * - Local users (defined in config or via HOST_USERS env variable)
         * - API/database validation (users_from_db=true)
         *
         * Core Settings:
         * --------------
         * - protected      : Enable/disable host protection globally
         * - user_auth      : Require user authentication for host access
         * - users_from_db  : Fetch users from API/database instead of local config
         * - maxAttempts    : Maximum login attempts before temporary block
         * - minBlockTime   : Block duration in minutes after max attempts exceeded
         *
         * API Integration:
         * ---------------
         * - users_api_secret_key    : Secret key for API authentication
         * - users_api_endpoint      : Endpoint to validate user credentials
         * - users_api_room_allowed  : Endpoint to check if user can access a room
         * - users_api_rooms_allowed : Endpoint to get allowed rooms for a user
         * - api_room_exists         : Endpoint to verify if a room exists
         *
         * Local User Configuration:
         * ------------------------
         * - users: Array of authorized users (used if users_from_db=false)
         *   - Define via HOST_USERS env variable:
         *     HOST_USERS is supplied by the rc script from the root-only users file.
         *     (Each user separated by '|', fields by ':', allowed_rooms comma-separated or '*' for all)
         *   - Each line contains username | password | display name | JSON meeting-key array or *.
         *   - Fields:
         *     - username      : Login username
         *     - password      : Login password
         *     - displayname   : User's display name
         *     - allowed_rooms : List of rooms user can access ('*' for all)
         *
         * Presenter Management:
         * --------------------
         * - list        : Array of usernames who can be presenters.
         *                 WARNING: with no auth provider enabled (protected / user_auth / OIDC),
         *                 the display name is unverified client input, so each entry acts as a
         *                 shared secret. Use unique, non-guessable values (never a real name or
         *                 email) or anyone who guesses it becomes presenter. Empty by default.
         * - join_first  : First joiner becomes presenter; when the last presenter leaves,
         *                 promote the first admitted participant (default: true)
         *
         * Documentation:
         * -------------
         * https://docs.mirotalk.com/mirotalk-sfu/host-protection/
         */
        host: {
            protected: process.env.HOST_PROTECTED === 'true',
            user_auth: process.env.HOST_USER_AUTH === 'true',

            maxAttempts: process.env.HOST_MAX_LOGIN_ATTEMPTS || 5,
            minBlockTime: process.env.HOST_MIN_LOGIN_BLOCK_TIME || 15, // in minutes

            users_from_db: process.env.HOST_USERS_FROM_DB === 'true',
            users_api_secret_key: process.env.USERS_API_SECRET || 'mirotalkweb_default_secret',
            users_api_endpoint: process.env.USERS_API_ENDPOINT || 'http://localhost:9000/api/v1/user/isAuth', // 'https://webrtc.mirotalk.com/api/v1/user/isAuth'
            users_api_room_allowed:
                process.env.USERS_ROOM_ALLOWED_ENDPOINT || 'http://localhost:9000/api/v1/user/isRoomAllowed', // 'https://webrtc.mirotalk.com/api/v1/user/isRoomAllowed'
            users_api_rooms_allowed:
                process.env.USERS_ROOMS_ALLOWED_ENDPOINT || 'http://localhost:9000/api/v1/user/roomsAllowed', // 'https://webrtc.mirotalk.com/api/v1/user/roomsAllowed'
            api_room_exists: process.env.ROOM_EXISTS_ENDPOINT || 'http://localhost:9000/api/v1/room/exists', // 'https://webrtc.mirotalk.com//api/v1/room/exists'

            users: process.env.HOST_USERS !== undefined
                ? ((hostUsers) => { delete process.env.HOST_USERS; return hostUsers; })(process.env.HOST_USERS)
                      .split('\n')
                      .filter((userStr) => userStr.trim() !== '' && !userStr.trimStart().startsWith('#'))
                      .map((userStr) => {
                      const fields = userStr.split('|');
                      const [username, password, displayname] = fields.slice(0, 3).map(field => field.trim());
                      const allowedRoomsStr = fields.slice(3).join('|').trim();
                      const allowedRooms = allowedRoomsStr === '*' ? ['*'] : JSON.parse(allowedRoomsStr);
                      if (!Array.isArray(allowedRooms) || !allowedRooms.every(key => key === '*' || require('./MeetingSettings').isMeetingKey(key))) throw new Error(`Invalid meeting grants for local user ${JSON.stringify(username)}; use a JSON array of printable Unicode keys.`);
                      return {
                          username: username || '',
                          password: password || '',
                          displayname: displayname || '',
                          allowed_rooms: allowedRooms,
                      };
                  })
                : [],

            // HARDENED: authorized attendees have equal standing. No automatic or
            // configured presenter role is issued to meeting participants.
            presenters: {
                list: [],
                join_first: false,
            },
        },
    },

    // ==============================================
    // 5. API Configuration
    // ==============================================

    /**
     * API Security & Endpoint Configuration
     * ====================================
     * Controls access to the SFU's API endpoints and integration settings.
     *
     * Security Settings:
     * -----------------
     * - keySecret : Authentication secret for API requests
     *               (Always override default in production)
     *
     * Endpoint Control:
     * -----------------
     * - stats      : Enable/disable system statistics endpoint [true/false] (default: true)
     * - meetings   : Enable/disable meetings list endpoint [true/false] (default: true)
     * - meeting    : Enable/disable single meeting operations [true/false] (default: true)
     * - join       : Enable/disable meeting join endpoint [true/false] (default: true)
     * - token      : Enable/disable token generation endpoint [true/false] (default: false)
     * - slack      : Enable/disable Slack webhook integration [true/false] (default: true)
     * - mattermost : Enable/disable Mattermost webhook integration [true/false] (default: true)
     *
     * API Documentation:
     * ------------------
     * - Complete API reference: https://docs.mirotalk.com/mirotalk-sfu/api/
     * - Webhook setup: See integration guides for Slack/Mattermost
     */
    api: {
        keySecret: process.env.API_KEY_SECRET,
        allowed: {
            stats: process.env.API_ALLOW_STATS !== 'false',
            meetings: false,
            meeting: process.env.API_ALLOW_MEETING !== 'false',
            meetingEnd: process.env.API_ALLOW_MEETING_END === 'true',
            join: process.env.API_ALLOW_JOIN !== 'false',
            token: process.env.API_ALLOW_TOKEN === 'true',
            slack: process.env.API_ALLOW_SLACK !== 'false',
            mattermost: process.env.API_ALLOW_MATTERMOST !== 'false',
        },
    },

    // ==============================================
    // 6. Third-Party Integrations
    // ==============================================

    integrations: {
        // Hosted OpenAI chat is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        chatGPT: {
            enabled: false,
            basePath: process.env.CHATGPT_BASE_PATH || 'https://api.openai.com/v1/',
            apiKey: process.env.CHATGPT_API_KEY || '',
            model: process.env.CHATGPT_MODEL || 'gpt-3.5-turbo',
            max_tokens: parseInt(process.env.CHATGPT_MAX_TOKENS) || 1024,
            temperature: parseInt(process.env.CHATGPT_TEMPERATURE) || 0.7,
        },

        // Hosted DeepSeek chat is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        deepSeek: {
            enabled: false,
            basePath: process.env.DEEP_SEEK_BASE_PATH || 'https://api.deepseek.com/v1/',
            apiKey: process.env.DEEP_SEEK_API_KEY || '',
            model: process.env.DEEP_SEEK_MODEL || 'deepseek-v4-flash',
            max_tokens: parseInt(process.env.DEEP_SEEK_MAX_TOKENS) || 1024,
            temperature: parseInt(process.env.DEEP_SEEK_TEMPERATURE) || 0.7,
        },

        // Whisper transcription is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        whisper: {
            enabled: false,
            basePath: process.env.WHISPER_BASE_PATH || 'https://api.openai.com/v1/',
            apiKey: process.env.WHISPER_API_KEY || '',
            model: process.env.WHISPER_MODEL || 'whisper-1',
            language: process.env.WHISPER_LANGUAGE || '',
            segmentSeconds: parseInt(process.env.WHISPER_SEGMENT_SECONDS) || 5,
            maxAudioBytes: parseInt(process.env.WHISPER_MAX_AUDIO_BYTES) || 25 * 1024 * 1024,
        },

        // HARDENED excludes external VideoAI providers.
        videoAI: { enabled: false },

        /**
         * Email Notification Configuration
         * ===============================
         * SMTP settings for system alerts and notifications
         *
         * Core Settings:
         * -------------
         * - alert      : Enable/disable email alerts [true/false] (default: false)
         * - notify     : Enable/disable room email notifications [true/false] (default: false)
         * - host       : SMTP server address (default: 'localhost')
         * - port       : SMTP port (default: 1025 for Mailpit, 587 for most providers)
         * - username   : SMTP auth username
         * - password   : SMTP auth password (store ONLY in .env)
         * - from       : Sender email address (default: same as username)
         * - sendTo     : Recipient email for alerts and notifications
         *
         * Common Providers:
         * ----------------
         * Gmail:
         * - host: smtp.gmail.com
         * - port: 587
         *
         * Office365:
         * - host: smtp.office365.com
         * - port: 587
         *
         * SendGrid:
         * - host: smtp.sendgrid.net
         * - port: 587
         *
         * Mailpit (local testing):
         * - host: localhost
         * - port: 1025
         * - docker-compose-mailpit.yml
         */
        email: {
            alert: process.env.EMAIL_ALERTS_ENABLED === 'true',
            notify: process.env.EMAIL_NOTIFICATIONS === 'true',
            host: process.env.EMAIL_HOST || 'localhost',
            port: parseInt(process.env.EMAIL_PORT) || 1025,
            username: process.env.EMAIL_USERNAME || 'test',
            password: process.env.EMAIL_PASSWORD || 'test',
            from: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
            sendTo: process.env.EMAIL_SEND_TO || 'test@mirotalk.com',
        },

        /**
         * Slack Integration Configuration
         * ==============================
         * Settings for Slack slash commands and interactivity
         *
         * Setup Instructions:
         * ------------------
         * 1. Create a Slack app at https://api.slack.com/apps
         * 2. Under "Basic Information" → "App Credentials":
         *    - Copy the Signing Secret
         * 3. Enable "Interactivity & Shortcuts" and "Slash Commands"
         * 4. Set Request URL to: https://your-domain.com/slack/commands
         *
         * Core Settings:
         * -------------
         * - enabled         : Enable/disable Slack integration [true/false] (default: false)
         * - signingSecret   : From Slack app credentials (store ONLY in .env)
         *
         */
        slack: {
            enabled: process.env.SLACK_ENABLED === 'true',
            signingSecret: process.env.SLACK_SIGNING_SECRET || '',
        },

        // Mattermost integration is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        mattermost: {
            enabled: false,
            serverUrl: process.env.MATTERMOST_SERVER_URL || '',
            username: process.env.MATTERMOST_USERNAME || '',
            password: process.env.MATTERMOST_PASSWORD || '',
            token: process.env.MATTERMOST_TOKEN || '',
            commands: [
                {
                    name: process.env.MATTERMOST_COMMAND_NAME || '/sfu',
                    message: process.env.MATTERMOST_DEFAULT_MESSAGE || 'Here is your meeting room:',
                },
            ],
            texts: [
                {
                    name: process.env.MATTERMOST_COMMAND_NAME || '/sfu',
                    message: process.env.MATTERMOST_DEFAULT_MESSAGE || 'Here is your meeting room:',
                },
            ],
        },

        // Discord integration is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        discord: {
            enabled: false,
            token: process.env.DISCORD_TOKEN || '',
            commands: [
                {
                    name: process.env.DISCORD_COMMAND_NAME || '/sfu',
                    message: process.env.DISCORD_DEFAULT_MESSAGE || 'Here is your SFU meeting room:',
                    baseUrl: process.env.DISCORD_BASE_URL || 'https://sfu.mirotalk.com/join/',
                },
            ],
        },

        // ngrok tunnelling is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        ngrok: {
            enabled: false,
            authToken: process.env.NGROK_AUTH_TOKEN || '',
        },

        // Sentry reporting is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        sentry: {
            enabled: false,
            logLevels: process.env.SENTRY_LOG_LEVELS
                ? process.env.SENTRY_LOG_LEVELS.split(splitChar).map((level) => level.trim())
                : ['error'],
            DSN: process.env.SENTRY_DSN || '',
            tracesSampleRate: Math.min(Math.max(parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.5, 0), 1),
        },

        /**
         * Webhook Configuration Settings
         * =============================
         * Controls the webhook notification system for sending event data to external services.
         *
         * Core Settings:
         * ---------------------
         * - enabled: Turns webhook notifications on/off
         * - url: The endpoint URL where webhook payloads will be sent in JSON format
         *
         * Implementation Guide:
         * --------------------
         * - For complete implementation examples, refer to:
         *      - Project demo: /mirotalksfu/webhook/ folder
         */
        webhook: {
            enabled: process.env.WEBHOOK_ENABLED === 'true',
            url: process.env.WEBHOOK_URL || 'https://your-site.com/webhook-endpoint',
        },

        // Amazon S3 storage is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        s3: {
            enabled: false,
            accessKeyId: process.env.S3_ACCESS_KEY_ID || 'your-access-key-id',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'your-secret-access-key',
            bucket: process.env.S3_BUCKET || 'mirotalk',
            region: process.env.S3_REGION || 'us-east-2',
            endpoint: process.env.S3_ENDPOINT || '',
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        },
    },

    // ==============================================
    // 7. UI/UX Customization
    // ==============================================

    ui: {
        /**
         * Branding & Appearance Configuration
         * -----------------------------------
         * Controls all aspects of the application's visual identity, content, and metadata.
         * Supports environment variable overrides for deployment-specific customization.
         *
         * ==============================================
         * LICENSE REQUIRED:
         * ==============================================
         * - https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
         */
        rooms: {
            /**
             * Room Display Settings
             * ---------------------
             * - showActive: Show active rooms in the UI (default: false)
             *   https://sfu.mirotalk.com/activeRooms
             * - activeRoomsRateLimit: Throttle the public /api/v1/activeRooms
             *   endpoint per IP to prevent enumeration/scraping abuse without
             *   breaking the public "event zone" UX.
             */
            showActive: false,
            activeRoomsRateLimit: {
                windowMs:
                    Math.max(parseInt(process.env.ACTIVE_ROOMS_RATE_LIMIT_WINDOW_MINUTES, 10) || 1, 1) * 60 * 1000,
                max: Math.max(parseInt(process.env.ACTIVE_ROOMS_RATE_LIMIT_MAX, 10) || 60, 1),
            },
        },
        brand: {
            /**
             * Application Branding
             * --------------------
             * Core application identity and user interface text elements.
             *
             * Note:
             * Set BRAND_HTML_INJECTION to 'false' to disable HTML injection.
             * This allows for static branding in the public/views folder, without dynamic content injection.
             */
            htmlInjection: process.env.BRAND_HTML_INJECTION !== 'false',
            siteTranslations,

            app: {
                language: process.env.UI_LANGUAGE || 'en',
                languages: process.env.UI_LANGUAGES
                    ? process.env.UI_LANGUAGES.split(',').map((code) => code.trim()).filter(Boolean)
                    : null,
                translationMode: 'native', // HARDENED uses only local language files
                name: process.env.APP_NAME || 'MiroTalk SFU',
                title:
                    process.env.APP_TITLE ||
                    '<h1>MiroTalk SFU</h1> Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
                description:
                    process.env.APP_DESCRIPTION ||
                    'Start your next video call with a single click. No download, plug-in, or login is required.',
                joinDescription: process.env.JOIN_DESCRIPTION || 'Pick a room name.<br />How about this one?',
                joinButtonLabel: process.env.JOIN_BUTTON_LABEL || 'Join meeting',
                customizeButtonLabel: process.env.CUSTOMIZE_BUTTON_LABEL || 'CUSTOMIZE ROOM',
                joinLastLabel: process.env.JOIN_LAST_LABEL || 'Your recent room:',
            },

            /**
             * Website Configuration
             * --------------------
             * Site-wide settings including icons and page-specific content.
             */
            site: {
                name: process.env.SITE_NAME || '',
                url: process.env.SITE_URL || '',
                contactEmail: process.env.SITE_CONTACT_EMAIL || '',
                description: process.env.SITE_DESCRIPTION || '',
                copyright: process.env.SITE_COPYRIGHT || '',
                logo: siteAssetUrl(process.env.SITE_LOGO_NAME) || '../images/logo.svg',
                logoUrl: process.env.SITE_LOGO_URL || process.env.SITE_URL || '/',
                title: process.env.SITE_TITLE || 'MiroTalk SFU - Open Source WebRTC Video Conferencing',
                icon: process.env.SITE_ICON_PATH || siteAssetUrl(process.env.SITE_LOGO_NAME) || '../images/logo.svg',
                appleTouchIcon:
                    process.env.APPLE_TOUCH_ICON_PATH || siteAssetUrl(process.env.SITE_LOGO_NAME) || '../images/logo.svg',
                sourceCodeUrl: sourceCodeUrl,
                privacyPolicyUrl:
                    process.env.PRIVACY_POLICY_URL || siteAssetUrl(process.env.PRIVACY_POLICY_NAME) || '',
                newRoomTitle: process.env.NEW_ROOM_TITLE || 'Pick name. <br />Share URL. <br />Start conference.',
                newRoomDescription:
                    process.env.NEW_ROOM_DESC || 'Each room has its disposable URL. Just pick a name and share.',
            },

            /**
             * SEO Metadata
             * ------------
             * Search engine optimization elements.
             */
            meta: {
                description:
                    process.env.META_DESCRIPTION ||
                    'Build your own Zoom alternative with MiroTalk SFU, an open-source, self-hosted WebRTC platform powered by Mediasoup for scalable video meetings.',
                keywords: process.env.META_KEYWORDS || 'webrtc, video calls, conference, screen sharing, mirotalk, sfu',
            },

            /**
             * OpenGraph/Social Media
             * ---------------------
             * Metadata for rich social media sharing.
             */
            og: {
                type: process.env.OG_TYPE || 'app-webrtc',
                siteName: process.env.OG_SITE_NAME || 'MiroTalk SFU',
                title: process.env.OG_TITLE || 'MiroTalk SFU - Open Source WebRTC Video Conferencing',
                description:
                    process.env.OG_DESCRIPTION ||
                    'Build your own Zoom alternative with MiroTalk SFU, an open-source self-hosted WebRTC video conferencing platform powered by Mediasoup. Host scalable meetings, webinars, classrooms, screen sharing and real-time collaboration.',
                image: process.env.OG_IMAGE_URL || new URL('/images/logo.svg', process.env.WEB_URL || process.env.SERVER_HOST_URL || 'https://localhost:3010').toString(),
                url: process.env.OG_URL || process.env.WEB_URL || process.env.SERVER_HOST_URL || 'https://localhost:3010',
            },

            /**
             * UI Section Visibility
             * ---------------------
             * Toggle display of various page sections.
             * Set to 'false' via environment variables to hide.
             */
            html: {
                topSponsors: process.env.SHOW_TOP_SPONSORS !== 'false',
                features: process.env.SHOW_FEATURES !== 'false',
                teams: process.env.SHOW_TEAMS !== 'false',
                tryEasier: process.env.SHOW_TRY_EASIER !== 'false',
                poweredBy: process.env.SHOW_POWERED_BY !== 'false',
                sponsors: process.env.SHOW_SPONSORS !== 'false',
                pastSponsors: process.env.SHOW_PAST_SPONSORS !== 'false',
                advertisers: process.env.SHOW_ADVERTISERS !== 'false',
                supportUs: false,
                footer: process.env.SHOW_FOOTER !== 'false',
            },

            /**
             * Who Are You? Section
             * ---------------------
             * Prompts users to identify themselves before joining a room.
             * Customizable text and button labels.
             */
            whoAreYou: {
                title: process.env.WHO_ARE_YOU_TITLE || 'MiroTalk SFU - Waiting for host to start the meeting',
                waitingRoomHeading: process.env.WHO_ARE_YOU_WAITING_ROOM_HEADING || 'Waiting for host...',
                waitingRoomDescription:
                    process.env.WHO_ARE_YOU_WAITING_ROOM_DESCRIPTION ||
                    "The meeting hasn't started yet.<br />You'll join automatically when the host opens the room.",
                waitingRoomStatus: process.env.WHO_ARE_YOU_WAITING_ROOM_STATUS || 'Checking room status...',
                waitingRoomReady: process.env.WHO_ARE_YOU_WAITING_ROOM_READY || 'Room is ready! Joining...',
                waitingRoomWaiting:
                    process.env.WHO_ARE_YOU_WAITING_ROOM_WAITING || 'Waiting for host to start the meeting...',
                waitingRoomHostLink: process.env.WHO_ARE_YOU_WAITING_ROOM_HOST_LINK || 'Are you the host?',
                waitingRoomLoginLink: process.env.WHO_ARE_YOU_WAITING_ROOM_LOGIN_LINK || 'Login here',
                waitingRoomElapsedJust: process.env.WHO_ARE_YOU_WAITING_ROOM_ELAPSED_JUST || 'Just started waiting',
                waitingRoomElapsedMinutes:
                    process.env.WHO_ARE_YOU_WAITING_ROOM_ELAPSED_MINUTES || 'Waiting for {minutes}',
                waitingRoomSongUrl: process.env.WHO_ARE_YOU_WAITING_ROOM_SONG_URL || '../sounds/waiting-music.mp3',
            },

            /**
             * Login Page Section
             * ---------------------
             * Customizable heading, description, and button label for the login page.
             */
            login: {
                heading: process.env.LOGIN_HEADING || 'Welcome back',
                description: process.env.LOGIN_INSTRUCTIONS ?? 'Enter your credentials to continue.',
                buttonLabel: process.env.LOGIN_BUTTON_LABEL || 'Login',
            },

            /**
             * About/Credits Section
             * ---------------------
             * Contains author information, version, and support links.
             * Supports HTML content for flexible formatting.
             */
            about: {
                imageUrl: process.env.ABOUT_IMAGE_URL || siteAssetUrl(process.env.SITE_LOGO_NAME) || '../images/mirotalk-logo.gif',
                title: `WebRTC SFU v${packageJson.version}`,
                html: `
                    <div class="about-content">
                        <p class="about-description">
                            Self-hosted group video meetings with scalable WebRTC conferencing.
                        </p>
                        <a
                            class="about-primary-action"
                            data-umami-event="About button"
                            href="${process.env.SUPPORT_URL || 'https://docs.mirotalk.com/sites/sfu'}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <i class="fas fa-info-circle" aria-hidden="true"></i>
                            <span>${process.env.SUPPORT_TEXT || 'About'}</span>
                        </a>
                        <dl class="about-details">
                            <div>
                                <dt>${process.env.AUTHOR_LABEL || 'Author'}</dt>
                                <dd>
                                    <a
                                        id="linkedin-button"
                                        data-umami-event="Linkedin button"
                                        href="${process.env.LINKEDIN_URL || 'https://www.linkedin.com/in/miroslav-pejic-976a07101/'}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >${process.env.AUTHOR_NAME || 'Miroslav Pejic'}</a>
                                </dd>
                            </div>
                            <div>
                                <dt>${process.env.EMAIL_LABEL || 'Email'}</dt>
                                <dd>
                                    <a
                                        id="email-button"
                                        data-umami-event="Email button"
                                        href="mailto:${process.env.CONTACT_EMAIL || 'miroslav.pejic.85@gmail.com'}?subject=${process.env.EMAIL_SUBJECT || 'MiroTalk SFU info'}"
                                    >${process.env.CONTACT_EMAIL || 'miroslav.pejic.85@gmail.com'}</a>
                                </dd>
                            </div>
                        </dl>
                        <footer class="about-footer">
                            &copy; ${new Date().getFullYear()} ${process.env.COPYRIGHT_TEXT || 'MiroTalk SFU · GNU AGPLv3'}
                        </footer>
                        <section class="about-build-info">
                        <p>This FreeBSD HARDENED build is part of the
                            <a href="https://www.freegateway.org/" target="_blank" rel="noopener noreferrer">FreeGateway Digital Sovereignty Project</a>.
                        </p>
                        <p>Modified for FreeBSD HARDENED in 2026. Distributed under the GNU Affero General Public License version 3; no warranty is provided.</p>
                        <p><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU AGPLv3 license</a></p>
                        <p>The complete Corresponding Source for this FreeBSD build, including its modifications and build files, is available below.</p>
                        <p><strong><a href="${sourceCodeUrl}" target="_blank" rel="noopener noreferrer">Download Corresponding Source for this FreeBSD build</a></strong></p>
                        </section>
                    </div>
                `,
            },

            // Support widget is disabled in HARDENED.
            // Retained fields describe the upstream data shape; they do not enable this feature.

            widget: {
                enabled: false,
                roomId: process.env.WIDGET_ROOM_ID || 'support-room',
                theme: process.env.WIDGET_THEME || 'dark',
                widgetState: process.env.WIDGET_STATE || 'minimized',
                widgetType: process.env.WIDGET_TYPE || 'support',
                supportWidget: {
                    position: process.env.WIDGET_SUPPORT_POSITION || 'top-right',
                    expertImages: process.env.WIDGET_SUPPORT_EXPERT_IMAGES
                        ? process.env.WIDGET_SUPPORT_EXPERT_IMAGES.split(splitChar)
                              .map((url) => url.trim())
                              .filter(Boolean)
                        : [
                              'https://photo.cloudron.pocketsolution.net/uploads/original/95/7d/a5f7f7a2c89a5fee7affda5f013c.jpeg',
                          ],
                    buttons: {
                        audio: process.env.WIDGET_SUPPORT_BUTTON_AUDIO !== 'false',
                        video: process.env.WIDGET_SUPPORT_BUTTON_VIDEO !== 'false',
                        screen: process.env.WIDGET_SUPPORT_BUTTON_SCREEN !== 'false',
                        chat: process.env.WIDGET_SUPPORT_BUTTON_CHAT !== 'false',
                        join: process.env.WIDGET_SUPPORT_BUTTON_JOIN !== 'false',
                    },
                    checkOnlineStatus: process.env.WIDGET_SUPPORT_CHECK_ONLINE_STATUS === 'true',
                    isOnline: process.env.WIDGET_SUPPORT_IS_ONLINE !== 'false',
                    customMessages: {
                        heading: process.env.WIDGET_SUPPORT_HEADING || 'Need Help?',
                        subheading:
                            process.env.WIDGET_SUPPORT_SUBHEADING || 'Get instant support from our expert team!',
                        connectText: process.env.WIDGET_SUPPORT_CONNECT_TEXT || 'connect in < 5 seconds',
                        onlineText: process.env.WIDGET_SUPPORT_ONLINE_TEXT || 'We are online',
                        offlineText: process.env.WIDGET_SUPPORT_OFFLINE_TEXT || 'We are offline',
                        poweredBy: process.env.WIDGET_SUPPORT_POWERED_BY || 'Powered by MiroTalk SFU',
                    },
                },
                alert: {
                    enabled: process.env.WIDGET_ALERT_ENABLED === 'true',
                    type: process.env.WIDGET_ALERT_TYPE || 'email',
                },
            },
            //...
        },

        /**
         * Theme definitions — CSS custom properties for each theme.
         * Admins can override individual themes or add new ones.
         * The client merges these with built-in defaults, so you
         * only need to specify the properties you want to change.
         */
        themes: {
            /* Example: override default theme background
            default: {
                '--body-bg': 'linear-gradient(135deg, #1a1a2e, #0a0a14)',
                '--msger-bg': 'linear-gradient(135deg, #1a1a2e, #0a0a14)',
            },
            */
            /* Example: add a custom theme
            ocean: {
                '--body-bg': 'linear-gradient(135deg, #0d2137, #061220)',
                '--trx-bg': 'linear-gradient(135deg, #0d2137, #061220)',
                '--msger-bg': 'linear-gradient(135deg, #0d2137, #061220)',
                '--left-msg-bg': '#112d4a',
                '--right-msg-bg': '#0a1f35',
                '--private-msg-bg': '#0e2540',
                '--select-bg': '#0f2a45',
                '--select-focus-color': 'rgba(56, 189, 248, 0.5)',
                '--tab-btn-active': '#163d5e',
                '--settings-bg': 'linear-gradient(135deg, #0d2137, #061220)',
                '--wb-bg': 'linear-gradient(135deg, #0d2137, #061220)',
                '--btns-bg-color': 'rgba(6, 18, 32, 0.75)',
                '--dd-color': '#38BDF8',
            },
            */
        },

        /**
         * UI Button Configuration
         * ---------------------
         * Organized by component/functionality area
         */
        buttons: {
            // Popup Configuration
            popup: {
                shareRoomPopup: process.env.SHOW_SHARE_ROOM_POPUP !== 'false',
                shareRoomQrOnHover: process.env.SHOW_SHARE_ROOM_QR_ON_HOVER !== 'false',
            },
            // Main control buttons visible in the UI
            main: {
                shareButton: process.env.SHOW_SHARE_BUTTON !== 'false',
                hideMeButton: process.env.SHOW_HIDE_ME !== 'false',
                fullScreenButton: process.env.SHOW_FULLSCREEN_BUTTON !== 'false',
                startAudioButton: process.env.SHOW_AUDIO_BUTTON !== 'false',
                startVideoButton: process.env.SHOW_VIDEO_BUTTON !== 'false',
                startScreenButton: process.env.SHOW_SCREEN_BUTTON !== 'false',
                swapCameraButton: process.env.SHOW_SWAP_CAMERA !== 'false',
                chatButton: process.env.SHOW_CHAT_BUTTON !== 'false',
                participantsButton: process.env.SHOW_PARTICIPANTS_BUTTON !== 'false',
                pollButton: process.env.SHOW_POLL_BUTTON !== 'false',
                speechRecButton: false,
                breakoutRoomButton: process.env.SHOW_BREAKOUT_ROOM_BUTTON !== 'false',
                editorButton: process.env.SHOW_EDITOR_BUTTON !== 'false',
                raiseHandButton: process.env.SHOW_RAISE_HAND !== 'false',
                transcriptionButton: false,
                whiteboardButton: process.env.SHOW_WHITEBOARD !== 'false',
                documentPiPButton: process.env.SHOW_DOCUMENT_PIP !== 'false',
                snapshotRoomButton: process.env.SHOW_SNAPSHOT !== 'false',
                emojiRoomButton: process.env.SHOW_EMOJI !== 'false',
                settingsButton: process.env.SHOW_SETTINGS !== 'false',
                aboutButton: process.env.SHOW_ABOUT !== 'false',
                exitButton: process.env.SHOW_EXIT_BUTTON !== 'false',
                extraButton: process.env.SHOW_EXTRA_BUTTON !== 'false',
            },
            // Settings panel buttons and options
            settings: {
                activeRooms: false,
                fileSharing: process.env.ENABLE_FILE_SHARING !== 'false',
                lockRoomButton: false,
                unlockRoomButton: false,
                broadcastingButton: false,
                lobbyButton: false,
                joinLockButton: false,
                sendEmailInvitation: false,
                micOptionsButton: process.env.SHOW_MIC_OPTIONS !== 'false',
                tabRTMPStreamingBtn: false,
                tabNotificationsBtn: process.env.SHOW_NOTIFICATIONS_TAB !== 'false',
                tabNetworkBtn: process.env.SHOW_NETWORK_TAB !== 'false',
                tabModerator: process.env.SHOW_MODERATOR_TAB !== 'false',
                tabVideoAIBtn: process.env.SHOW_VIDEOAI_TAB !== 'false',
                tabRecording: process.env.SHOW_RECORDING_TAB !== 'false',
                host_only_recording: process.env.HOST_ONLY_RECORDING !== 'false',
                pushToTalk: process.env.ENABLE_PUSH_TO_TALK !== 'false',
                keyboardShortcuts: process.env.SHOW_KEYBOARD_SHORTCUTS !== 'false',
                virtualBackground: process.env.SHOW_VIRTUAL_BACKGROUND !== 'false',
                customNoiseSuppression: process.env.CUSTOM_NOISE_SUPPRESSION_ENABLED !== 'false',
                customNoiseSuppressionDefault: process.env.CUSTOM_NOISE_SUPPRESSION_DEFAULT === 'true', // initial state, users can still toggle it
            },

            // Video controls for producer (local user)
            producerVideo: {
                videoPictureInPicture: process.env.ENABLE_PIP !== 'false',
                videoMirrorButton: process.env.SHOW_MIRROR_BUTTON !== 'false',
                pinVideoButton: process.env.SHOW_PIN_BUTTON !== 'false',
                fullScreenButton: process.env.SHOW_FULLSCREEN !== 'false',
                snapShotButton: process.env.SHOW_SNAPSHOT_BUTTON !== 'false',
                focusVideoButton: process.env.SHOW_FOCUS_BUTTON !== 'false',
                muteAudioButton: process.env.SHOW_MUTE_AUDIO !== 'false',
                videoPrivacyButton: process.env.SHOW_PRIVACY_TOGGLE !== 'false',
                audioVolumeInput: process.env.SHOW_VOLUME_CONTROL !== 'false',
                drawingButton: process.env.SHOW_DRAWING_BUTTON !== 'false',
            },

            // Video controls for consumer (remote users)
            consumerVideo: {
                videoPictureInPicture: process.env.ENABLE_PIP !== 'false',
                videoMirrorButton: process.env.SHOW_MIRROR_BUTTON !== 'false',
                pinVideoButton: process.env.SHOW_PIN_BUTTON !== 'false',
                fullScreenButton: process.env.SHOW_FULLSCREEN !== 'false',
                snapShotButton: process.env.SHOW_SNAPSHOT_BUTTON !== 'false',
                focusVideoButton: process.env.SHOW_FOCUS_BUTTON !== 'false',
                hideFromGridButton: process.env.SHOW_HIDE_FROM_GRID_BUTTON !== 'false',
                sendMessageButton: process.env.SHOW_SEND_MESSAGE !== 'false',
                sendFileButton: process.env.SHOW_SEND_FILE !== 'false',
                sendVideoButton: process.env.SHOW_SEND_VIDEO !== 'false',
                muteVideoButton: process.env.SHOW_MUTE_VIDEO !== 'false',
                muteAudioButton: process.env.SHOW_MUTE_AUDIO !== 'false',
                audioVolumeInput: process.env.SHOW_VOLUME_CONTROL !== 'false',
                banButton: process.env.SHOW_BAN_BUTTON !== 'false',
                ejectButton: process.env.SHOW_EJECT_BUTTON !== 'false',
                presenterRoleButton: process.env.SHOW_PRESENTER_ROLE_BUTTON !== 'false',
                drawingButton: process.env.SHOW_DRAWING_BUTTON !== 'false',
            },

            // Controls when video is off
            videoOff: {
                pinVideoButton: process.env.SHOW_PIN_BUTTON !== 'false',
                hideFromGridButton: process.env.SHOW_HIDE_FROM_GRID_BUTTON !== 'false',
                sendMessageButton: process.env.SHOW_SEND_MESSAGE !== 'false',
                sendFileButton: process.env.SHOW_SEND_FILE !== 'false',
                sendVideoButton: process.env.SHOW_SEND_VIDEO !== 'false',
                muteAudioButton: process.env.SHOW_MUTE_AUDIO !== 'false',
                audioVolumeInput: process.env.SHOW_VOLUME_CONTROL !== 'false',
                banButton: process.env.SHOW_BAN_BUTTON !== 'false',
                ejectButton: process.env.SHOW_EJECT_BUTTON !== 'false',
                presenterRoleButton: process.env.SHOW_PRESENTER_ROLE_BUTTON !== 'false',
            },

            // Controls for shared video/audio feeds
            videoShare: {
                pinVideoButton: process.env.SHOW_PIN_BUTTON !== 'false',
                fullScreenButton: process.env.SHOW_FULLSCREEN !== 'false',
            },

            // Chat interface controls
            chat: {
                chatPinButton: process.env.SHOW_CHAT_PIN !== 'false',
                chatMaxButton: process.env.SHOW_CHAT_MAXIMIZE !== 'false',
                chatSaveButton: process.env.SHOW_CHAT_SAVE !== 'false',
                chatEmojiButton: process.env.SHOW_CHAT_EMOJI !== 'false',
                chatMarkdownButton: process.env.SHOW_CHAT_MARKDOWN !== 'false',
                chatSpeechStartButton: false,
                chatTyping: process.env.ENABLE_CHAT_TYPING === 'true',
                chatGPT: false,
                deepSeek: false,
            },

            // Poll interface controls
            poll: {
                pollPinButton: process.env.SHOW_POLL_PIN !== 'false',
                pollMaxButton: process.env.SHOW_POLL_MAXIMIZE !== 'false',
                pollSaveButton: process.env.SHOW_POLL_SAVE !== 'false',
            },

            // Participants list controls
            participantsList: {
                saveInfoButton: process.env.SHOW_SAVE_INFO !== 'false',
                sendFileAllButton: process.env.SHOW_SEND_FILE_ALL !== 'false',
                ejectAllButton: process.env.SHOW_EJECT_ALL !== 'false',
                sendFileButton: process.env.SHOW_SEND_FILE !== 'false',
                banButton: process.env.SHOW_BAN_BUTTON !== 'false',
                ejectButton: process.env.SHOW_EJECT_BUTTON !== 'false',
                presenterRoleButton: process.env.SHOW_PRESENTER_ROLE_BUTTON !== 'false',
            },

            // Whiteboard controls
            whiteboard: {
                whiteboardLockButton: process.env.SHOW_WB_LOCK !== 'false',
            },
        },
    },

    // ==============================================
    // 8. Feature Flags
    // ==============================================

    features: {
        /**
         * Survey Configuration (QuestionPro)
         * =================================
         * Settings for user feedback and survey integration
         *
         * Setup Instructions:
         * ------------------
         * 1. Sign up at https://www.questionpro.com/
         * 2. Create survey:
         *    - Use template or custom questions
         *    - Configure survey logic and branching
         * 3. Get survey URL:
         *    - Publish survey
         *    - Copy "Collect Responses" link
         */
        survey: {
            enabled: process.env.SURVEY_ENABLED === 'true',
            url: process.env.SURVEY_URL || '',
        },

        /**
         * Post-Call Redirect
         * ---------------------
         * - enabled: Redirect after call ends
         * - url: Redirect destination URL
         */
        redirect: {
            enabled: process.env.REDIRECT_ENABLED === 'true',
            url: process.env.REDIRECT_URL || '',
        },

        // Scheduling and email invitations is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        scheduleMeeting: {
            enabled: false,
            requireAuth: process.env.SCHEDULE_MEETING_REQUIRE_AUTH !== 'false',
            maxRecipients: Math.max(parseInt(process.env.SCHEDULE_MEETING_MAX_RECIPIENTS, 10) || 20, 1),
            allowedDomains: (process.env.SCHEDULE_MEETING_ALLOWED_DOMAINS || '')
                .split(splitChar)
                .map((domain) => domain.trim().toLowerCase())
                .filter(Boolean),
            rateLimit: {
                windowMs:
                    Math.max(parseInt(process.env.SCHEDULE_MEETING_RATE_LIMIT_WINDOW_MINUTES, 10) || 60, 1) * 60 * 1000,
                max: Math.max(parseInt(process.env.SCHEDULE_MEETING_RATE_LIMIT_MAX, 10) || 5, 1),
            },
        },

        /**
         * Socket.IO createRoom rate limit (per IP)
         * ----------------------------------------
         * Prevents unauthenticated sockets from spamming arbitrary entries
         * into the in-memory roomList (which feeds /api/v1/activeRooms),
         * and throttles room creation token requests.
         */
        createRoomRateLimit: {
            windowMs: Math.max(parseInt(process.env.CREATE_ROOM_RATE_LIMIT_WINDOW_MINUTES, 10) || 1, 1) * 60 * 1000,
            max: Math.max(parseInt(process.env.CREATE_ROOM_RATE_LIMIT_MAX, 10) || 10, 1),
        },

        // External analytics is disabled in HARDENED.
        // Retained fields describe the upstream data shape; they do not enable this feature.

        stats: {
            enabled: false,
            src: '',
            id: '',
        },
    },

    /**
     * Moderation Configuration
     * =======================
     * Controls global moderation features.
     *
     * Core Settings:
     * --------------
     * - room.maxParticipants: Maximum number of participants allowed per room.
     * - lobby: Enable/disable lobby feature for pre-approval of participants.
     *   Adjust to limit room size and manage server load.
     */
    moderation: {
        room: {
            maxParticipants: parseInt(process.env.ROOM_MAX_PARTICIPANTS) || 1000, // Maximum participants per room
            lobby: false, // HARDENED: no presenter is required to admit authorized attendees
        },
    },

    // ==============================================
    // 9. Mediasoup (WebRTC) Configuration
    // ==============================================

    /**
     * Mediasoup Integration Resources
     * ==============================
     * Core WebRTC components powering MiroTalk SFU
     *
     * Essential Links:
     * ---------------
     * - 🌐 Website     : https://mediasoup.org
     * - 💬 Forum       : https://mediasoup.discourse.group
     *
     * 📚 Documentation:
     * ----------------
     * - Client API     : https://mediasoup.org/documentation/v3/mediasoup-client/api/
     * - Server API     : https://mediasoup.org/documentation/v3/mediasoup/api/
     * - Protocols      : https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/
     *
     * 🔧 Key Components:
     * -----------------
     * - Router         : Manages RTP streams
     * - Transport      : Network connection handler
     * - Producer       : Media sender
     * - Consumer       : Media receiver
     *
     * Mediasoup Configuration
     * -----------------------
     * This configuration defines settings for mediasoup workers, routers,
     * WebRTC servers, and transports. These settings control how the SFU
     * (Selective Forwarding Unit) handles media processing and networking.
     */
    mediasoup: {
        /**
         * Worker Configuration
         * --------------------
         * Workers are separate processes that handle media processing.
         * Multiple workers can run in parallel for load balancing.
         */
        worker: {
            rtcMinPort: RTC_MIN_PORT, // Minimum UDP/TCP port for ICE, DTLS, RTP
            rtcMaxPort: RTC_MAX_PORT, // Maximum UDP/TCP port for ICE, DTLS, RTP

            // Disable Linux io_uring for certain operations (false = use if available)
            disableLiburing: false,

            // Logging level (error, warn, debug, etc.)
            logLevel: process.env.MEDIASOUP_LOG_LEVEL || 'error',

            // Detailed logging for specific components:
            logTags: [
                'info', // General information
                'ice', // ICE (Interactive Connectivity Establishment) events
                'dtls', // DTLS handshake and encryption
                'rtp', // RTP packet flow
                'srtp', // Secure RTP encryption
                'rtcp', // RTCP control protocol
                'rtx', // Retransmissions
                'bwe', // Bandwidth estimation
                'score', // Network score calculations
                'simulcast', // Simulcast layers
                'svc', // Scalable Video Coding
                'sctp', // SCTP data channels
            ],
        },
        numWorkers: NUM_WORKERS, // Number of mediasoup worker processes to create

        /**
         * Router Configuration
         * --------------------
         * Routers manage media streams and define what codecs are supported.
         * Each mediasoup worker can host multiple routers.
         */
        router: {
            // Enable audio level monitoring (for detecting who is speaking)
            audioLevelObserverEnabled: process.env.MEDIASOUP_ROUTER_AUDIO_LEVEL_OBSERVER_ENABLED !== 'false',

            // Disable active speaker detection (uses more CPU)
            activeSpeakerObserverEnabled: process.env.MEDIASOUP_ROUTER_ACTIVE_SPEAKER_OBSERVER_ENABLED === 'true',

            /**
             * Supported Media Codecs
             * ----------------------
             * Defines what codecs the SFU can receive and forward.
             * Order matters - first is preferred during negotiation.
             */
            mediaCodecs: [
                // Opus audio codec (standard for WebRTC)
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000, // Standard sample rate for WebRTC
                    channels: 2, // Stereo audio
                },

                // VP8 video codec (widely supported, good for compatibility)
                {
                    kind: 'video',
                    mimeType: 'video/VP8',
                    clockRate: 90000, // Standard video clock rate
                    parameters: {
                        'x-google-start-bitrate': 1000, // Initial bitrate (kbps)
                    },
                },

                // VP9 video codec (better compression than VP8)
                // Profile 0: Most widely supported VP9 profile
                {
                    kind: 'video',
                    mimeType: 'video/VP9',
                    clockRate: 90000,
                    parameters: {
                        'profile-id': 0, // Baseline profile
                        'x-google-start-bitrate': 1000,
                    },
                },

                // VP9 Profile 2: Supports HDR and 10/12-bit color
                {
                    kind: 'video',
                    mimeType: 'video/VP9',
                    clockRate: 90000,
                    parameters: {
                        'profile-id': 2, // Advanced profile
                        'x-google-start-bitrate': 1000,
                    },
                },

                // H.264 Baseline profile (widest hardware support)
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1, // Required for WebRTC
                        'profile-level-id': '42e01f', // Baseline 3.1
                        'level-asymmetry-allowed': 1, // Allows different levels
                        'x-google-start-bitrate': 1000,
                    },
                },

                // H.264 Main profile (better compression than Baseline)
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '4d0032', // Main 4.0
                        'level-asymmetry-allowed': 1,
                        'x-google-start-bitrate': 1000,
                    },
                },
            ],
        },

        /**
         * WebRTC Server Configuration
         * ---------------------------
         * WebRTC servers handle ICE (connection establishment) and DTLS (encryption).
         * Can be disabled if using plain WebRtcTransport instead.
         *
         * Best used when:
         * - Running in controlled environments with fixed IPs
         * - Need to minimize port usage across workers
         * - Using StatefulSets/DaemonSets in Kubernetes
         *
         * Kubernetes considerations:
         * - Requires stable network identity (use StatefulSet)
         * - Needs NodePort/LoadBalancer with externalTrafficPolicy: Local
         * - Port ranges must be carefully allocated to avoid conflicts
         *
         * Optional Config:
         * - https://mediasoup.discourse.group/t/mediasoup-3-17-0-released/6805
         */
        webRtcServerActive: process.env.SFU_SERVER === 'true', // Enable if SFU_SERVER=true
        webRtcServerOptions: {
            // Network interfaces and ports for ICE candidates
            listenInfos: [
                /**
                 * UDP Configuration
                 * Preferred for media transport (lower latency)
                 * Kubernetes implications:
                 * - Each Pod needs unique ports if sharing host network
                 * - Consider using hostPort when not using LoadBalancer
                 */
                {
                    protocol: 'udp',
                    ip: LISTEN_IP, // Local IP to bind to
                    announcedAddress: IPv4, // Public IP sent to clients
                    portRange: {
                        min: RTC_MIN_PORT,
                        max: RTC_MIN_PORT + NUM_WORKERS, // Port range per worker
                    },
                },
                /**
                 * TCP Configuration
                 * Fallback for restrictive networks (higher latency)
                 * Kubernetes implications:
                 * - Helps with networks blocking UDP
                 * - May require separate Service definition in k8s
                 */
                {
                    protocol: 'tcp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: {
                        min: RTC_MIN_PORT,
                        max: RTC_MIN_PORT + NUM_WORKERS,
                    },
                },
            ],
        },

        /**
         * WebRTC Transport Configuration
         * ------------------------------
         * Transports handle the actual media flow between clients and the SFU.
         * These settings affect bandwidth management and network behavior.
         *
         * Preferred when:
         * - Running in cloud environments with auto-scaling
         * - Need dynamic port allocation
         * - Kubernetes Pods are ephemeral
         *
         * Kubernetes considerations:
         * - Requires wide port range exposure (50000-60000 typical)
         * - Works better with ClusterIP Services
         * - More resilient to Pod restarts
         */
        webRtcTransport: {
            // Network interfaces for media transmission
            listenInfos: [
                /**
                 * UDP Transport Settings
                 * Kubernetes implications:
                 * - Needs hostNetwork or privileged Pod for port access
                 * - Consider port range size based on expected scale
                 */
                {
                    protocol: 'udp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: {
                        min: RTC_MIN_PORT,
                        max: RTC_MAX_PORT, // Wider range than WebRtcServer
                    },
                },
                /**
                 * TCP Transport Settings
                 * Kubernetes implications:
                 * - Less efficient but more compatible
                 * - May require different Service configuration
                 */
                {
                    protocol: 'tcp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: {
                        min: RTC_MIN_PORT,
                        max: RTC_MAX_PORT,
                    },
                },
            ],

            iceConsentTimeout: 35, // Timeout for ICE consent (seconds)

            /**
             * Bandwidth Control Settings
             * Kubernetes implications:
             * - These values should be tuned based on Node resources
             * - Consider network plugin overhead (Calico, Cilium etc.)
             */
            initialAvailableOutgoingBitrate: 2500000, // 2.5 Mbps initial bitrate
            minimumAvailableOutgoingBitrate: 1000000, // 1 Mbps minimum guaranteed
            maxIncomingBitrate: 3000000, // 3 Mbps max per producer

            /**
             * Data Channel Settings (mediasoup 3.20.0+)
             * - maxSendMessageSize    : Max size for outgoing SCTP messages (data channels)
             * - maxReceiveMessageSize : Max size for incoming SCTP messages (data channels)
             * Replaces the legacy `maxSctpMessageSize` / `numSctpStreams` options.
             * Kubernetes implications:
             * - Affects memory allocation per transport
             * - Larger sizes may require Pod resource adjustments
             */
            maxSendMessageSize: 262144, // 256 KB max outgoing data-channel message size
            maxReceiveMessageSize: 262144, // 256 KB max incoming data-channel message size
        },
    },
};

// ==============================================
// Helper Functions
// ==============================================

/**
 * Get IPv4 Address
 * ----------------
 * - Prioritizes ANNOUNCED_IP if set
 * - Falls back to local IP detection
 */
function getIPv4() {
    if (ANNOUNCED_IP) return ANNOUNCED_IP;

    switch (ENVIRONMENT) {
        case 'development':
            return IS_DOCKER ? '127.0.0.1' : getLocalIPv4();
        case 'production':
            return ANNOUNCED_IP;
        default:
            return getLocalIPv4();
    }
}

/**
 * Detect Local IPv4 Address
 * -------------------------
 * - Handles different OS network interfaces
 * - Filters out virtual/docker interfaces
 */
function getLocalIPv4() {
    const ifaces = os.networkInterfaces();
    const platform = os.platform();

    const PRIORITY_CONFIG = {
        win32: [{ name: 'Ethernet' }, { name: 'Wi-Fi' }, { name: 'Local Area Connection' }],
        darwin: [{ name: 'en0' }, { name: 'en1' }],
        linux: [{ name: 'eth0' }, { name: 'wlan0' }],
    };

    const VIRTUAL_INTERFACES = {
        all: ['docker', 'veth', 'tun', 'lo'],
        win32: ['Virtual', 'vEthernet', 'Teredo', 'Bluetooth'],
        darwin: ['awdl', 'bridge', 'utun'],
        linux: ['virbr', 'kube', 'cni'],
    };

    const platformPriorities = PRIORITY_CONFIG[platform] || [];
    const virtualExcludes = [...VIRTUAL_INTERFACES.all, ...(VIRTUAL_INTERFACES[platform] || [])];

    // Check priority interfaces first
    for (const { name: ifName } of platformPriorities) {
        const matchingIfaces = platform === 'win32' ? Object.keys(ifaces).filter((k) => k.includes(ifName)) : [ifName];
        for (const interfaceName of matchingIfaces) {
            const addr = findValidAddress(ifaces[interfaceName]);
            if (addr) return addr;
        }
    }

    // Fallback to scanning all non-virtual interfaces
    const fallbackAddress = scanAllInterfaces(ifaces, virtualExcludes);
    if (fallbackAddress) return fallbackAddress;

    return '0.0.0.0';
}

/**
 * Scan All Network Interfaces
 * ---------------------------
 * - Checks all interfaces excluding virtual ones
 */
function scanAllInterfaces(ifaces, excludes) {
    for (const [name, addresses] of Object.entries(ifaces)) {
        if (excludes.some((ex) => name.toLowerCase().includes(ex.toLowerCase()))) {
            continue;
        }
        const addr = findValidAddress(addresses);
        if (addr) return addr;
    }
    return null;
}

/**
 * Find Valid Network Address
 * --------------------------
 * - Filters out internal and link-local addresses
 */
function findValidAddress(addresses) {
    return addresses?.find((addr) => addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.'))
        ?.address;
}

/**
 * Get FFmpeg Path
 * ---------------
 * - Checks common installation locations
 * - Platform-specific paths
 */
function getFFmpegPath(platform) {
    const paths = {
        darwin: ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'],
        linux: ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
        win32: ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'],
    };

    const platformPaths = paths[platform] || ['/usr/bin/ffmpeg'];

    for (const path of platformPaths) {
        try {
            fs.accessSync(path);
            return path;
        } catch (e) {
            continue;
        }
    }

    return platformPaths[0];
}
