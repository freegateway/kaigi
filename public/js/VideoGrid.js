'use strict';

// ####################################################
// RESPONSIVE PARTICIPANTS VIEW
// ####################################################

let customRatio = true;
let isHideALLVideosActive = false;

// aspect       0      1      2      3       4
let ratios = ['0:0', '4:3', '16:9', '1:1', '1:2'];
let aspect = 2;

let ratio = getAspectRatio();

function getAspectRatio() {
    customRatio = aspect == 0 ? true : false;
    var ratio = ratios[aspect].split(':');
    return ratio[1] / ratio[0];
}

function setAspectRatio(i) {
    aspect = i;
    ratio = getAspectRatio();
    resizeVideoMedia();
}

function Area(Increment, Count, Width, Height, Margin = 10) {
    ratio = customRatio ? 0.75 : ratio;
    let i = 0;
    let w = 0;
    let h = Increment * ratio + Margin * 2;
    while (i < Count) {
        if (w + Increment > Width) {
            w = 0;
            h = h + Increment * ratio + Margin * 2;
        }
        w = w + Increment + Margin * 2;
        i++;
    }
    if (h > Height) return false;
    else return Increment;
}

function resizeVideoMedia() {
    if (isHideALLVideosActive) return;

    let Margin = 5;
    let videoMediaContainer = document.getElementById('videoMediaContainer');
    let Cameras = getVisibleCameraElements();
    let Width = videoMediaContainer.offsetWidth - Margin * 2;
    const reservedHeight = parseFloat(getComputedStyle(videoMediaContainer).paddingBottom) || 0;
    let Height = Math.max(0, videoMediaContainer.offsetHeight - reservedHeight - Margin * 2);
    let max = 0;
    let isOneVideoElement = Cameras.length === 1;
    let isPinnedSingleVideo = isOneVideoElement && typeof rc !== 'undefined' && rc.isVideoPinned;
    let expandSingleVideo = isOneVideoElement && !isPinnedSingleVideo;

    // console.log('videoMediaContainer.childElementCount', {
    //     isOneVideoElement: isOneVideoElement,
    //     children: videoMediaContainer.childElementCount,
    // });

    // full screen mode
    let bigWidth = Width * 4;
    if (expandSingleVideo) {
        Width = Width - bigWidth;
    }

    resetZoom();
    if (layoutPinnedStrip(videoMediaContainer, Cameras, Width, Height, Margin)) {
        if (typeof VideoDrawingOverlay !== 'undefined') VideoDrawingOverlay.resizeAll();
        return;
    }

    // Optimized: binary search for best tile size
    let low = 1;
    let high = Math.min(Width, Height);
    if (isPinnedSingleVideo) {
        // Fixed 4:3 thumbnails: the adaptive aspect ratio depends on the participant count,
    // and the strip tiles must keep the same size no matter how many people join
    const tileRatio = 0.75;
        high = Math.min(Width, Math.floor((Height - Margin * 2) / tileRatio));
    }
    let best = 1;
    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let w = Area(mid, Cameras.length, Width, Height, Margin);
        if (w !== false) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    max = best - Margin * 2;
    setWidth(Cameras, max, bigWidth, Margin, Height, expandSingleVideo);

    // When alone, use fixed avatar size; otherwise proportional to tile
    const avatarSize = expandSingleVideo ? Math.min(200, Math.max(120, Height * 0.25)) : max / 3;
    document.documentElement.style.setProperty('--vmi-wh', avatarSize + 'px');

    // Resize any active drawing overlays to match new tile dimensions
    if (typeof VideoDrawingOverlay !== 'undefined') {
        VideoDrawingOverlay.resizeAll();
    }
}

function layoutPinnedStrip(container, Cameras, Width, Height, Margin) {
    const pinned = typeof rc !== 'undefined' && !!rc?.isVideoPinned;
    const active = pinned && Cameras.length > 0 && Width > 0;

    if (!active) {
        container.classList.remove('pinned-strip', 'pinned-strip-vertical', 'pinned-strip-overflow');
        return false;
    }

    container.classList.remove('screen-stage', 'screen-stage-landscape');
    Cameras.forEach(c => c.removeAttribute('data-screen-stage'));
    const horizontal = rc.videoPinPosition ? !['speaker-left', 'speaker-right', 'vertical'].includes(rc.videoPinPosition) : Width > Height;
    container.classList.add('pinned-strip');
    container.classList.toggle('pinned-strip-vertical', !horizontal);

    // Fixed 4:3 thumbnails: the adaptive aspect ratio depends on the participant count,
    // and the strip tiles must keep the same size no matter how many people join
    const tileRatio = 0.75;
    let tileW, tileH;
    if (horizontal) {
        // Keep part of the next tile in view so it is clear the row scrolls
        const maxTileW = Math.floor(Width / 2.4) - Margin * 2;
        tileH = Math.max(40, Height - Margin * 2);
        tileW = Math.round(tileH / tileRatio);
        if (tileW > maxTileW) {
            tileW = Math.max(40, maxTileW);
            tileH = Math.round(tileW * tileRatio);
        }
    } else {
        // Vertical column: tiles take the full column width
        tileW = Math.max(40, Width - Margin * 2);
        tileH = Math.round(tileW * tileRatio);
    }

    Cameras.forEach((c) => {
        c.style.width = tileW + 'px';
        c.style.height = tileH + 'px';
        c.style.margin = Margin + 'px';
    });

    const stripLength = Cameras.length * ((horizontal ? tileW : tileH) + Margin * 2);
    container.classList.toggle('pinned-strip-overflow', stripLength > (horizontal ? Width : Height) + Margin * 2);

    if (!container.dataset.pinnedStripWheel) {
        container.dataset.pinnedStripWheel = '1';
        container.addEventListener(
            'wheel',
            (e) => {
                // Vertical wheel scrolls the row (the vertical column scrolls natively);
                // over a video the wheel keeps zooming the tile
                if (!container.classList.contains('pinned-strip-overflow')) return;
                if (container.classList.contains('pinned-strip-vertical')) return;
                if (e.target.closest('video') || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                container.scrollLeft += e.deltaY;
                e.preventDefault();
            },
            { passive: false }
        );
    }

    document.documentElement.style.setProperty('--vmi-wh', Math.max(32, tileW / 3) + 'px');
    return true;
}

let layoutAnimationRaf = null;

/**
 * Check if the user asked the system to reduce motion
 * @returns {boolean}
 */
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Smoothly re-layout the video grid while a side panel (chat, transcription, ...) is pinned/unpinned.
 * The CSS transition (see .layout-animating) glides the containers, and the tiles
 * are recomputed every frame so they always follow the container's current size.
 * Call it right BEFORE changing the containers' size, so the transition kicks in.
 * @param {number} duration animation length in ms (keep in sync with .layout-animating in VideoGrid.css)
 */
function animateVideoLayout(duration = 240) {
    if (prefersReducedMotion()) return;
    const root = document.documentElement;
    root.classList.add('layout-animating');
    cancelAnimationFrame(layoutAnimationRaf);
    const end = performance.now() + duration + 60;
    const step = (now) => {
        resizeVideoMedia();
        if (now < end) {
            layoutAnimationRaf = requestAnimationFrame(step);
        } else {
            root.classList.remove('layout-animating');
            resizeVideoMedia();
        }
    };
    layoutAnimationRaf = requestAnimationFrame(step);
}

function getVisibleCameraElements() {
    return Array.from(document.getElementsByClassName('Camera')).filter(camera => !camera.hidden &&
        camera.getAttribute('aria-hidden') !== 'true' && !camera.classList.contains('hidden') && camera.style.display !== 'none');
}

function resetZoom() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
        video.style.transform = '';
        video.style.transformOrigin = 'center';
    });
}

function setWidth(Cameras, width, bigWidth, margin, maxHeight, isOneVideoElement) {
    ratio = customRatio ? 0.68 : ratio;
    for (let s = 0; s < Cameras.length; s++) {
        Cameras[s].style.width = width + 'px';
        Cameras[s].style.margin = margin + 'px';
        Cameras[s].style.height = width * ratio + 'px';
        if (isOneVideoElement) {
            Cameras[s].style.width = bigWidth + 'px';
            Cameras[s].style.height = bigWidth * ratio + 'px';
            let camHeigh = Cameras[s].style.height.substring(0, Cameras[s].style.height.length - 2);
            if (camHeigh >= maxHeight) Cameras[s].style.height = maxHeight - 2 + 'px';
        }
    }
}

// ####################################################
// BREAKPOINTS
// ####################################################

const MOBILE_BREAKPOINT = 500;
const TABLET_BREAKPOINT = 580;
const DESKTOP_BREAKPOINT = 730;
const CUSTOM_BREAKPOINT = 680;

// ####################################################
// RESPONSIVE CHAT
// ####################################################

function resizeChatRoom() {
    if (!rc || rc.isMobileDevice || !rc.isChatOpen || rc.isChatPinned) return;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    windowWidth <= DESKTOP_BREAKPOINT || windowHeight <= DESKTOP_BREAKPOINT ? rc.chatMaximize() : rc.chatMinimize();
}

// ####################################################
// RESPONSIVE TRANSCRIPTION
// ####################################################

function resizeTranscriptionRoom() {
    if (
        isMobileDevice ||
        !Boolean(transcription.speechTranscription) ||
        transcription.isHidden ||
        transcription.isPinned
    )
        return;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    windowWidth <= CUSTOM_BREAKPOINT || windowHeight <= CUSTOM_BREAKPOINT
        ? transcription.maximize()
        : transcription.minimize();
}

// ####################################################
// WINDOW LOAD/RESIZE EVENT
// ####################################################

window.addEventListener(
    'load',
    function (event) {
        resizeVideoMedia();
        let resizeTimeout;
        window.addEventListener('resize', function () {
            if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
            resizeTimeout = requestAnimationFrame(function () {
                resizeVideoMedia();
                resizeChatRoom();
                resizeTranscriptionRoom();
            });
        });
    },
    false
);
