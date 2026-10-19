'use strict';

const title = document.getElementById('title');
const icon = document.getElementById('icon');
const appleTouchIcon = document.getElementById('appleTouchIcon');
const headerLogo = document.getElementById('headerLogo') || document.querySelector('.site-header .header-logo-image');
const headerLogoLink = document.getElementById('headerLogoLink') || headerLogo?.closest('a');
const privacyPolicyLink = document.getElementById('privacyPolicyLink');
const siteCopyright = document.getElementById('siteCopyright');

// Site-owned CSS is loaded after MiroTalk's stylesheets so administrators can
// override presentation without modifying packaged application files.
const siteStylesheet = document.createElement('link');
siteStylesheet.rel = 'stylesheet';
siteStylesheet.href = '/site-assets/site.css';
document.head.appendChild(siteStylesheet);
const newRoomTitle = document.getElementById('newRoomTitle');
const loginNewRoomTitle = document.getElementById('loginNewRoomTitle');
const joinSelectRoomButton = document.getElementById('joinSelectRoomButton');
const newRoomDescription = document.getElementById('newRoomDescription');

const description = document.getElementById('description');
const keywords = document.getElementById('keywords');

const appTitle = document.getElementById('appTitle');
const appDescription = document.getElementById('appDescription');
const joinDescription = document.getElementById('joinDescription');
const joinRoomBtn = document.getElementById('joinRoomButton');
const customizeRoomBtn = document.getElementById('customizeRoomButton');
const joinLastLabel = document.getElementById('joinLastLabel');

const topSponsors = document.getElementById('topSponsors');
const features = document.getElementById('features');
const teams = document.getElementById('teams');
const tryEasier = document.getElementById('tryEasier');
const poweredBy = document.getElementById('poweredBy');
const sponsors = document.getElementById('sponsors');
const pastSponsors = document.getElementById('pastSponsors');
const advertisers = document.getElementById('advertisers');
const supportUs = document.getElementById('supportUs');
const footer = document.getElementById('footer');

const waitingRoomHeading = document.getElementById('waitingRoomHeading');
const waitingRoomDescription = document.getElementById('waitingRoomDescription');
const waitingRoomStatus = document.getElementById('waitingStatus');
const waitingRoomHostLink = document.getElementById('waitingRoomHostLink');
const waitingRoomLoginLink = document.getElementById('waitingRoomLoginLink');

const loginHeading = document.getElementById('loginHeading');
const loginDescription = document.getElementById('loginDescription');
const loginButton = document.getElementById('loginButton');
//...

// app/src/config.js - ui.brand
let BRAND = {
    app: {
        language: 'en',
        name: 'MiroTalk SFU',
        title: 'MiroTalk SFU<br />Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
        description:
            'Start your next video call with a single click. No download, plug-in, or login is required. Just get straight to talking, messaging, and sharing your screen.',
        joinDescription: 'Pick a room name.<br />How about this one?',
        joinButtonLabel: 'Join meeting',
        customizeButtonLabel: 'CUSTOMIZE ROOM',
        joinLastLabel: 'Your recent room:',
    },
    site: {
        title: 'MiroTalk SFU - Open Source WebRTC Video Conferencing',
        icon: '../images/logo.svg',
        appleTouchIcon: '../images/logo.svg',
        newRoomTitle: 'Pick name. <br />Share URL. <br />Start conference.',
        newRoomDescription:
            "Each room has its disposable URL. Just pick a room name and share your custom URL. It's that easy.",
    },
    meta: {
        description:
            'Build your own Zoom alternative with MiroTalk SFU, an open-source, self-hosted WebRTC platform powered by Mediasoup for scalable video meetings.',
        keywords:
            'webrtc, miro, mediasoup, mediasoup-client, self hosted, voip, sip, real-time communications, chat, messaging, meet, webrtc stun, webrtc turn, webrtc p2p, webrtc sfu, video meeting, video chat, video conference, multi video chat, multi video conference, peer to peer, p2p, sfu, rtc, alternative to, zoom, microsoft teams, google meet, jitsi, meeting',
    },
    html: {
        topSponsors: true,
        features: true,
        teams: true,
        tryEasier: true,
        poweredBy: true,
        sponsors: true,
        pastSponsors: true,
        advertisers: true,
        supportUs: true,
        footer: true,
    },
    whoAreYou: {
        title: 'MiroTalk SFU - Waiting for host to start the meeting',
        waitingRoomHeading: 'Waiting for host...',
        waitingRoomDescription:
            "The meeting hasn't started yet.<br />You'll join automatically when the host opens the room.",
        waitingRoomStatus: 'Checking room status...',
        waitingRoomReady: 'Room is ready! Joining...',
        waitingRoomWaiting: 'Waiting for host to start the meeting...',
        waitingRoomHostLink: 'Are you the host?',
        waitingRoomLoginLink: 'Login here',
        waitingRoomElapsedJust: 'Just started waiting',
        waitingRoomElapsedMinutes: 'Waiting for {minutes}',
        waitingRoomSongUrl: '',
    },
    login: {
        heading: 'Welcome back',
        description: 'Enter your credentials to continue.',
        buttonLabel: 'Login',
    },
    about: {
        imageUrl: '../images/mirotalk-logo.gif',
        title: '<strong>WebRTC SFU v2.6.48</strong>',
        html: `
            <div class="about-content">
                <p class="about-description">
                    Self-hosted group video meetings with scalable WebRTC conferencing.
                </p>
                <a
                    class="about-primary-action"
                    data-umami-event="About button"
                    href="https://docs.mirotalk.com/sites/sfu"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <i class="fas fa-info-circle" aria-hidden="true"></i>
                    <span>About</span>
                </a>
                <dl class="about-details">
                    <div>
                        <dt>Author</dt>
                        <dd>
                            <a
                                id="linkedin-button"
                                data-umami-event="Linkedin button"
                                href="https://www.linkedin.com/in/miroslav-pejic-976a07101/"
                                target="_blank"
                                rel="noopener noreferrer"
                            >Miroslav Pejic</a>
                        </dd>
                    </div>
                    <div>
                        <dt>Email</dt>
                        <dd>
                            <a
                                id="email-button"
                                data-umami-event="Email button"
                                href="mailto:miroslav.pejic.85@gmail.com?subject=MiroTalk SFU info"
                            >miroslav.pejic.85@gmail.com</a>
                        </dd>
                    </div>
                </dl>
                <footer class="about-footer">
                    &copy; ${new Date().getFullYear()} MiroTalk SFU. All rights reserved.
                </footer>
            </div>
        `,
    },
    widget: {
        enabled: false,
        roomId: 'support-room',
        theme: 'dark',
        widgetState: 'minimized',
        widgetType: 'support',
        supportWidget: {
            position: 'top-right',
            expertImages: [
                '/images/avatars/avatar_01.png',
            ],
            buttons: {
                audio: true,
                video: true,
                screen: true,
                chat: true,
                join: true,
            },
            checkOnlineStatus: false,
            isOnline: true,
            customMessages: {
                heading: 'Need Help?',
                subheading: 'Get instant support from our expert team!',
                connectText: 'connect in < 5 seconds',
                onlineText: 'We are online',
                offlineText: 'We are offline',
                poweredBy: 'Powered by MiroTalk SFU',
            },
            alert: {
                enabled: false,
                type: 'email',
            },
        },
    },
    //...
};

async function initialize() {
    await getBrand();

    customizeSite();

    customizeMetaTags();

    customizeApp();

    customizeWidget();

    customizeWhoAreYou();

    customizeLogin();

    try { BRAND.meetingTranslations = window.sessionStorage.peer_token ? JSON.parse(window.sessionStorage.mirotalk_meeting_translations || '{}') : {}; } catch { BRAND.meetingTranslations = {}; }
    baseSiteBrand = JSON.parse(JSON.stringify(BRAND));
    window.applySiteTranslations(window.i18n?.getLang?.() || BRAND.app?.language || 'en');
    checkBrand();

    // Notify listeners (e.g. I18n.js) that BRAND is fully resolved.
    document.dispatchEvent(new CustomEvent('brand:ready'));
}

async function getBrand() {
    try {
        const response = await fetch('/brand', { timeout: 5000 });
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        const serverBrand = data.message;
        if (serverBrand) {
            setBrand(serverBrand);
            console.log('FETCH BRAND SETTINGS', {
                serverBrand: serverBrand,
                clientBrand: BRAND,
            });
        } else {
            console.warn('FETCH BRAND SETTINGS - DISABLED');
        }
    } catch (error) {
        console.error('FETCH GET BRAND ERROR', error.message);
    }
}

// Apply administrator text by setting name, independently of application dictionaries.
function localizedSiteBrand(base, language) {
    const brand = JSON.parse(JSON.stringify(base));
    const dictionaries = base.siteTranslations || {};
    const values = { ...(dictionaries.en || {}), ...(dictionaries[language.split('-')[0]] || {}), ...(dictionaries[language] || {}) };
    const paths = {
        SITE_NAME: [['site','name'],['app','name'],['og','site_name']],
        SITE_DESCRIPTION: [['site','description'],['app','description'],['meta','description'],['og','description']],
        SITE_COPYRIGHT: [['site','copyright']], PAGE_TITLE: [['site','title'],['og','title']],
        JOIN_DESCRIPTION: [['app','joinDescription']], JOIN_BUTTON_LABEL: [['app','joinButtonLabel']],
        CUSTOMIZE_BUTTON_LABEL: [['app','customizeButtonLabel']], JOIN_LAST_LABEL: [['app','joinLastLabel']],
        NEW_ROOM_TITLE: [['site','newRoomTitle']], NEW_ROOM_DESCRIPTION: [['site','newRoomDescription']],
        LOGIN_HEADING: [['login','heading']], LOGIN_INSTRUCTIONS: [['login','description']], LOGIN_BUTTON_LABEL: [['login','buttonLabel']],
    };
    for (const [name, value] of Object.entries(values)) for (const [section, key] of paths[name] || []) {
        brand[section] ||= {}; brand[section][key] = value;
    }
    if (Object.hasOwn(values, 'SITE_NAME') || Object.hasOwn(values, 'SITE_DESCRIPTION')) {
        // Administrator text is rendered as text below, including the landing heading.
        const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        brand.app.title = `<h1>${escape(brand.site.name ?? brand.app.name)}</h1>${escape(brand.site.description || '')}`;
    }
    return brand;
}
let baseSiteBrand;
window.meetingLabel = (key, language = window.i18n?.getLang?.() || BRAND.app?.language || 'en') => {
    const dictionary = BRAND.meetingTranslations || {};
    const labels = Object.hasOwn(dictionary, key) ? dictionary[key] : {};
    for (const code of [language, language.split('-')[0], 'en']) if (Object.hasOwn(labels, code)) return labels[code];
    return key;
};
window.setMeetingTranslations = (translations) => {
    BRAND.meetingTranslations = translations;
    if (baseSiteBrand) baseSiteBrand.meetingTranslations = translations;
    window.refreshMeetingLabels();
};
window.refreshMeetingLabels = () => {
    const selector = document.getElementById('selectRoom');
    if (selector) for (const option of selector.options) { option.setAttribute('data-i18n-skip', ''); option.textContent = window.meetingLabel(option.value); }
    for (const element of document.querySelectorAll('[data-meeting-key]')) element.textContent = window.meetingLabel(element.dataset.meetingKey);
};
window.applySiteTranslations = (language) => {
    if (!baseSiteBrand) return;
    BRAND = localizedSiteBrand(baseSiteBrand, language);
    customizeSite(); customizeMetaTags(); customizeApp(); customizeLogin();
    window.refreshMeetingLabels();
    const name = document.getElementById('siteName'), description = document.getElementById('siteDescription');
    if (name) name.textContent = BRAND.site?.name || BRAND.app?.name || 'Video Conferencing';
    if (description) description.textContent = BRAND.site?.description || '';
    if (siteCopyright) siteCopyright.hidden = !BRAND.site?.copyright;
    for (const [property, value] of [['og:title', BRAND.og?.title], ['og:description', BRAND.og?.description], ['og:site_name', BRAND.og?.site_name]]) {
        const element = document.querySelector(`meta[property="${property}"]`);
        if (element && value !== undefined) element.content = value;
    }
};

// BRAND configurations
function setBrand(data) {
    BRAND = mergeBrand(BRAND, data);
    console.log('Set Brand done');
}

function mergeBrand(current, updated) {
    for (const key of Object.keys(updated)) {
        if (!current.hasOwnProperty(key) || typeof updated[key] !== 'object') {
            current[key] = updated[key];
        } else {
            mergeBrand(current[key], updated[key]);
        }
    }
    return current;
}

// BRAND check
function checkBrand() {
    !BRAND.html.topSponsors && elementDisplay(topSponsors, false);
    !BRAND.html.features && elementDisplay(features, false);
    !BRAND.html.teams && elementDisplay(teams, false);
    !BRAND.html.tryEasier && elementDisplay(tryEasier, false);
    !BRAND.html.poweredBy && elementDisplay(poweredBy, false);
    !BRAND.html.sponsors && elementDisplay(sponsors, false);
    !BRAND.html.pastSponsors && elementDisplay(pastSponsors, false);
    !BRAND.html.advertisers && elementDisplay(advertisers, false);
    !BRAND.html.supportUs && elementDisplay(supportUs, false);
    !BRAND.html.footer && elementDisplay(footer, false);
}

// ELEMENT display mode
function elementDisplay(element, display, mode = 'block') {
    if (!element) return;
    element.style.display = display ? mode : 'none';
}

// APP customize
function customizeApp() {
    if (appTitle && BRAND.app?.title !== undefined) {
        appTitle.innerHTML = BRAND.app?.title;
    }
    if (appDescription && BRAND.app?.description !== undefined) {
        appDescription.textContent = BRAND.app.description;
    }
    if (joinDescription && BRAND.app?.joinDescription !== undefined) {
        joinDescription.innerHTML = BRAND.app.joinDescription;
    }
    if (joinRoomBtn && BRAND.app?.joinButtonLabel !== undefined) {
        joinRoomBtn.innerText = BRAND.app.joinButtonLabel;
    }
    if (customizeRoomBtn && BRAND.app?.customizeButtonLabel !== undefined) {
        customizeRoomBtn.innerText = BRAND.app.customizeButtonLabel;
    }
    if (joinLastLabel && BRAND.app?.joinLastLabel !== undefined) {
        joinLastLabel.innerText = BRAND.app.joinLastLabel;
    }
}

// WIDGET customize
function customizeWidget() {
    if (BRAND.widget?.enabled) {
        const domain = window.location.host;
        const roomId = BRAND.widget?.roomId || 'support-room';
        const userName = 'guest-' + Math.floor(Math.random() * 10000);
        if (typeof MiroTalkWidget !== 'undefined') {
            new MiroTalkWidget(domain, roomId, userName, BRAND.widget);
        } else {
            console.warn('MiroTalkWidget is not defined in the current context. Please check Widget.js loading.', {
                domain,
                roomId,
                userName,
                widget: BRAND.widget,
            });
        }
    }
}

// SITE metadata
function customizeSite() {
    if (title && BRAND.site?.title !== undefined) {
        title.textContent = BRAND.site?.title;
    }
    if (icon && BRAND.site?.icon) {
        icon.href = BRAND.site?.icon;
    }
    if (appleTouchIcon && BRAND.site?.appleTouchIcon) {
        appleTouchIcon.href = BRAND.site.appleTouchIcon;
    }
    if (BRAND.site?.logo) {
        document.querySelectorAll("[data-brand-logo]").forEach((image) => {
            image.src = BRAND.site.logo;
        });
    }
    if (headerLogo && BRAND.site?.logo) {
        headerLogo.src = BRAND.site.logo;
        headerLogo.alt = BRAND.site?.name || BRAND.app?.name || 'Site logo';
    }
    if (headerLogoLink && BRAND.site?.logoUrl) {
        headerLogoLink.href = BRAND.site.logoUrl;
    }
    if (privacyPolicyLink && BRAND.site?.privacyPolicyUrl) {
        privacyPolicyLink.href = BRAND.site.privacyPolicyUrl;
        privacyPolicyLink.hidden = false;
    }
    if (siteCopyright) {
        siteCopyright.textContent = BRAND.site?.copyright || '';
        siteCopyright.hidden = false;
    }
    if (newRoomTitle && BRAND.site?.newRoomTitle !== undefined) {
        newRoomTitle.innerHTML = BRAND.site?.newRoomTitle;
    }
    if (loginNewRoomTitle && BRAND.site?.newRoomTitle !== undefined) {
        loginNewRoomTitle.innerHTML = BRAND.site.newRoomTitle;
    }
    if (joinSelectRoomButton && BRAND.app?.joinButtonLabel !== undefined) {
        joinSelectRoomButton.querySelector('#joinSelectRoomLabel').textContent = BRAND.app.joinButtonLabel;
    }
    const loginNewRoomDescription = document.getElementById('loginNewRoomDescription');
    if (loginNewRoomDescription && BRAND.site?.newRoomDescription !== undefined) {
        loginNewRoomDescription.textContent = BRAND.site.newRoomDescription;
    }
    if (newRoomDescription && BRAND.site?.newRoomDescription !== undefined) {
        newRoomDescription.textContent = BRAND.site.newRoomDescription;
    }
}

// SEO metadata
function customizeMetaTags() {
    if (description && BRAND.meta?.description !== undefined) {
        description.content = BRAND.meta.description;
    }
    if (keywords && BRAND.meta?.keywords) {
        keywords.content = BRAND.meta.keywords;
    }
}

function customizeWhoAreYou() {
    if (waitingRoomHeading && title && BRAND.whoAreYou?.title) title.textContent = BRAND.whoAreYou.title;
    if (waitingRoomHeading && BRAND.whoAreYou?.waitingRoomHeading)
        waitingRoomHeading.textContent = BRAND.whoAreYou.waitingRoomHeading;
    if (waitingRoomDescription && BRAND.whoAreYou?.waitingRoomDescription)
        waitingRoomDescription.innerHTML = BRAND.whoAreYou.waitingRoomDescription;
    if (waitingRoomStatus && BRAND.whoAreYou?.waitingRoomStatus)
        waitingRoomStatus.textContent = BRAND.whoAreYou.waitingRoomStatus;
    if (waitingRoomHostLink && BRAND.whoAreYou?.waitingRoomHostLink)
        waitingRoomHostLink.textContent = BRAND.whoAreYou.waitingRoomHostLink;
    if (waitingRoomLoginLink && BRAND.whoAreYou?.waitingRoomLoginLink)
        waitingRoomLoginLink.textContent = BRAND.whoAreYou.waitingRoomLoginLink;
}

function customizeLogin() {
    if (loginHeading && BRAND.login?.heading !== undefined) loginHeading.textContent = BRAND.login.heading;
    if (loginDescription && BRAND.login?.description !== undefined) loginDescription.textContent = BRAND.login.description;
    if (BRAND.login?.buttonLabel !== undefined) {
        const loginBtnText = document.getElementById('loginBtnText');
        if (loginBtnText) {
            loginBtnText.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i>&nbsp; ' + BRAND.login.buttonLabel;
        } else if (loginButton) {
            loginButton.textContent = BRAND.login.buttonLabel;
        }
    }
}

initialize();
