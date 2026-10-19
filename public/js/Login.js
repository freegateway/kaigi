'use strict';

console.log(window.location);

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginButton');
const loginBtnText = document.getElementById('loginBtnText');
const loginBtnLoader = document.getElementById('loginBtnLoader');
const loginIconEl = document.getElementById('loginIconEl');

const joinRoomForm = document.getElementById('joinRoomForm');
const selectRoom = document.getElementById('selectRoom');
const joinSelectRoomBtn = document.getElementById('joinSelectRoomButton');
const generateRoomBtn = document.getElementById('generateRoomButton');
const logoutBtn = document.getElementById('logoutButton');

const togglePasswordBtn = document.getElementById('togglePassword');
if (togglePasswordBtn) {
    togglePasswordBtn.onclick = () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        togglePasswordBtn.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        const label = isPassword ? 'Hide password' : 'Show password';
        togglePasswordBtn.title = label;
        togglePasswordBtn.setAttribute('aria-label', label);
        togglePasswordBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
    };
}

function setLoginLoading(loading) {
    loginBtn.disabled = loading;
    loginBtnText.style.display = loading ? 'none' : 'inline';
    loginBtnLoader.classList.toggle('show', loading);
    if (loading) {
        loginBtn.classList.remove('pulse');
    } else {
        loginBtn.classList.add('pulse');
    }
}

function showJoinRoomForm() {
    loginForm.style.opacity = '0';
    loginForm.style.transform = 'translateY(-10px)';
    setTimeout(() => {
        loginForm.style.display = 'none';
        joinRoomForm.classList.add('show');
        joinRoomForm.style.opacity = '0';
        joinRoomForm.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            joinRoomForm.style.opacity = '1';
            joinRoomForm.style.transform = 'translateY(0)';
        });
    }, 250);
}

function clearAuthenticatedSession() {
    window.sessionStorage.removeItem('peer_token');
    window.sessionStorage.removeItem('mirotalk_allowed_rooms');
    window.sessionStorage.removeItem('mirotalk_meeting_translations');
    window.sessionStorage.removeItem('mirotalk_allow_any_meeting');
    window.setMeetingTranslations?.({});
    window.sessionStorage.removeItem('mirotalk_displayname');
    window.sessionStorage.removeItem('mirotalk_login_name');
    window.sessionStorage.removeItem('mirotalk_auth_idle_timeout');
    window.sessionStorage.removeItem('mirotalk_auth_session_max_age');
    window.sessionStorage.removeItem('mirotalk_auth_session_started_at');
    window.sessionStorage.removeItem('roomID');
}

let authSessionMonitorStarted = false;
let authSessionLastActivity = Date.now();
let authSessionLastTouch = 0;

function getAuthenticatedSessionConfig() {
    return {
        idleTimeout: Number(window.sessionStorage.mirotalk_auth_idle_timeout || 0),
        maxAge: Number(window.sessionStorage.mirotalk_auth_session_max_age || 0),
        startedAt: Number(window.sessionStorage.mirotalk_auth_session_started_at || 0),
    };
}

async function terminateAuthenticatedSession(target = '/login?logged_out=1') {
    const token = window.sessionStorage.peer_token;
    if (token) {
        try {
            await fetch('/auth/session/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                keepalive: true,
            });
        } catch (error) {
            console.warn('Unable to notify server during logout', error);
        }
    }
    clearAuthenticatedSession();
    window.location.replace(target);
}

async function touchAuthenticatedSession() {
    const token = window.sessionStorage.peer_token;
    if (!token) return false;

    try {
        const response = await fetch('/auth/session/touch', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            clearAuthenticatedSession();
            window.location.replace('/login?session_expired=1');
            return false;
        }
        authSessionLastTouch = Date.now();
        return true;
    } catch (error) {
        console.warn('Unable to refresh authenticated session', error);
        return false;
    }
}

function startAuthenticatedSessionMonitor() {
    if (authSessionMonitorStarted || !window.sessionStorage.peer_token) return;
    authSessionMonitorStarted = true;
    authSessionLastActivity = Date.now();

    const { idleTimeout, maxAge, startedAt } = getAuthenticatedSessionConfig();
    const idleMs = idleTimeout > 0 ? idleTimeout * 1000 : 0;
    const maxAgeMs = maxAge > 0 ? maxAge * 1000 : 0;
    const touchInterval = idleMs > 0 ? Math.max(250, Math.min(15000, Math.floor(idleMs / 3))) : 15000;

    const recordActivity = () => {
        authSessionLastActivity = Date.now();
        if (Date.now() - authSessionLastTouch >= touchInterval) void touchAuthenticatedSession();
    };

    for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) {
        window.addEventListener(eventName, recordActivity, { passive: true });
    }
    window.addEventListener('focus', recordActivity);

    const checkInterval = Math.max(250, Math.min(1000, idleMs > 0 ? Math.floor(idleMs / 4) : 1000));
    window.setInterval(() => {
        const now = Date.now();
        if (maxAgeMs > 0 && startedAt > 0 && now - startedAt >= maxAgeMs) {
            void terminateAuthenticatedSession('/login?session_expired=1');
            return;
        }
        if (idleMs > 0 && now - authSessionLastActivity >= idleMs) {
            void terminateAuthenticatedSession('/login?session_expired=1');
        }
    }, checkInterval);

    void touchAuthenticatedSession();
}

function storeAuthenticatedSession(response, fallbackUsername) {
    const token = response.data.message;
    const allowedRooms = Array.isArray(response.data.allowedRooms) ? response.data.allowedRooms : [];
    const displayname = response.data.displayname || fallbackUsername;

    window.sessionStorage.peer_token = token;
    window.sessionStorage.mirotalk_allowed_rooms = JSON.stringify(allowedRooms);
    window.sessionStorage.mirotalk_allow_any_meeting = String(response.data.allowAnyMeeting === true);
    window.sessionStorage.mirotalk_meeting_translations = JSON.stringify(response.data.meetingTranslations || {});
    window.setMeetingTranslations?.(response.data.meetingTranslations || {});
    window.sessionStorage.mirotalk_displayname = displayname;
    window.sessionStorage.mirotalk_login_name = response.data.username || fallbackUsername;
    window.sessionStorage.mirotalk_auth_idle_timeout = String(response.data.authSession?.idleTimeout || 0);
    window.sessionStorage.mirotalk_auth_session_max_age = String(response.data.authSession?.maxAge || 0);
    window.sessionStorage.mirotalk_auth_session_started_at = String(response.data.authSession?.startedAt || Date.now());
    startAuthenticatedSessionMonitor();

    return { token, allowedRooms, displayname };
}

function configureRoomSelector(allowedRooms, displayname) {
    if (!Array.isArray(allowedRooms) || allowedRooms.length === 0) return false;

    const existingCustomRoomInput = document.getElementById('customRoomInput');
    if (existingCustomRoomInput) existingCustomRoomInput.remove();

    selectRoom.innerHTML = '';
    selectRoom.style.display = '';

    if (!(allowedRooms.includes('*') && window.sessionStorage.mirotalk_allow_any_meeting === 'true')) {
        console.log('User detected with limited join room access!', allowedRooms);
        allowedRooms.forEach((room) => {
            const option = document.createElement('option');
            option.value = room;
            option.setAttribute('data-i18n-skip', '');
            option.text = window.meetingLabel?.(room) || room;
            selectRoom.appendChild(option);
        });
        if (generateRoomBtn) generateRoomBtn.style.display = 'none';
        joinSelectRoomBtn.onclick = () => join();
        showJoinRoomForm();
        return true;
    }

    console.log('User detected with admin access!', allowedRooms);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'customRoomInput';
    input.placeholder = 'Enter room name';
    input.className = 'form-input';
    input.maxLength = 256;
    selectRoom.parentNode.insertBefore(input, selectRoom);
    selectRoom.style.display = 'none';
    if (generateRoomBtn) generateRoomBtn.style.display = 'block';
    joinSelectRoomBtn.onclick = () => {
        const roomName = input.value;
        if (roomName) {
            window.localStorage.peer_name = displayname;
            void selectAuthorizedMeeting(roomName);
        } else {
            highlightEmpty(input);
        }
    };
    showJoinRoomForm();
    return true;
}

function restoreAuthenticatedRoomSelector() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('logged_out') === '1') {
        clearAuthenticatedSession();
        params.delete('logged_out');
        params.delete('select');
        const query = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
        return;
    }

    const token = window.sessionStorage.peer_token;
    const serializedAllowedRooms = window.sessionStorage.mirotalk_allowed_rooms;
    const displayname = window.sessionStorage.mirotalk_displayname;
    if (!token || !serializedAllowedRooms || !displayname) return;

    try {
        const allowedRooms = JSON.parse(serializedAllowedRooms);
        configureRoomSelector(allowedRooms, displayname);
        startAuthenticatedSessionMonitor();
    } catch (error) {
        console.warn('Unable to restore authenticated room selector', error);
        clearAuthenticatedSession();
    }
}

function logout() {
    void terminateAuthenticatedSession('/login?logged_out=1');
}

joinSelectRoomBtn.onclick = (e) => {
    join();
};

if (logoutBtn) {
    logoutBtn.onclick = () => logout();
}

if (generateRoomBtn) {
    generateRoomBtn.onclick = (e) => {
        e.preventDefault();
        const uuid = getUUID4();
        const custom = document.getElementById('customRoomInput');
        if (custom && custom.offsetParent !== null) {
            custom.value = uuid;
        } else if (selectRoom && selectRoom.style.display !== 'none') {
            popup('warning', 'Random room is available for Admin users only');
        }
    };
}

const shareRoomBtn = document.getElementById('shareRoomButton');
if (shareRoomBtn) {
    shareRoomBtn.onclick = (e) => {
        e.preventDefault();
        const custom = document.getElementById('customRoomInput');
        const roomName =
            custom && custom.offsetParent !== null
                ? custom.value
                : selectRoom
                  ? selectRoom.value
                  : '';
        if (!roomName) {
            const inputEl = custom && custom.offsetParent !== null ? custom : selectRoom;
            if (inputEl) highlightEmpty(inputEl);
            return;
        }
        const roomUrl = window.location.origin + '/';
        const invitation = roomUrl + '\n' + (window.i18n?.t('Meeting name:', 'labels') || 'Meeting name:') + ' ' + (window.meetingLabel?.(roomName) || roomName);
        if (navigator.share) {
            navigator.share({ title: 'Meeting invitation', url: roomUrl, text: invitation }).catch(() => {});
        } else {
            navigator.clipboard
                .writeText(invitation)
                .then(() => popup('success', 'Room link copied to clipboard!'))
                .catch(() => popup('warning', 'Failed to copy link'));
        }
    };
}

usernameInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};
passwordInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};

loginBtn.onclick = (e) => {
    login();
};

function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (username && password) {
        setLoginLoading(true);
        hideLoginError();

        axios
            .post('/login', {
                username: username,
                password: password,
            })
            .then(function (response) {
                console.log(response);

                const { allowedRooms, displayname } = storeAuthenticatedSession(response, username);

                configureRoomSelector(allowedRooms, displayname);
                return;
            })
            .catch(function (error) {
                console.error(error);
                setLoginLoading(false);
                if (error.response && error.response.status === 429) {
                    const msg = error.response.data?.message || 'Too many login attempts. Please try again later.';
                    showLoginError(msg);
                } else if (error.response?.data?.code === 'NO_MEETING_GRANTS') {
                    showLoginError('No meetings are assigned to your account. Please contact your administrator.');
                } else {
                    showLoginError('Invalid credentials. Please try again.');
                }
            });
        return;
    }
    if (!username && !password) {
        highlightEmpty(usernameInput);
        highlightEmpty(passwordInput);
        return;
    }
    if (!username) {
        highlightEmpty(usernameInput);
        return;
    }
    if (!password) {
        highlightEmpty(passwordInput);
        return;
    }
}

function highlightEmpty(input) {
    const group = input.closest('.login-input-group');
    if (!group) return;
    group.classList.remove('input-error');
    void group.offsetWidth; // force reflow to restart animation
    group.classList.add('input-error');
    input.focus();
    function clearError() {
        group.classList.remove('input-error');
        input.removeEventListener('input', clearError);
        input.removeEventListener('change', clearError);
        input.removeEventListener('blur', clearError);
    }
    input.addEventListener('input', clearError);
    input.addEventListener('change', clearError);
    input.addEventListener('blur', clearError);
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    const text = document.getElementById('loginErrorText');
    if (!el || !text) return;
    text.textContent = window.i18n?.t ? window.i18n.t(msg, 'labels') : msg;
    el.classList.add('show');
}

function hideLoginError() {
    const el = document.getElementById('loginError');
    if (el) el.classList.remove('show');
}

function join() {
    const username = filterXSS(window.sessionStorage.mirotalk_displayname || document.getElementById('username').value);
    const roomId = document.getElementById('selectRoom').value;
    window.localStorage.peer_name = username;
    void selectAuthorizedMeeting(roomId);
}

function getUUID4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

restoreAuthenticatedRoomSelector();

async function selectAuthorizedMeeting(meeting) {
    try {
        const response = await fetch('/auth/meeting/select', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.sessionStorage.peer_token || ''}` },
            body: JSON.stringify({ meeting }),
        });
        if (response.status === 401) { await terminateAuthenticatedSession('/login?session_expired=1'); return; }
        if (!response.ok) { showLoginError('This room is not allowed for this user'); return; }
        const data = await response.json();
        if (!/^\/meeting\?selection=[a-f0-9-]{36}$/.test(data.navigation)) throw new Error('Invalid meeting navigation');
        window.location.assign(data.navigation);
    } catch { showLoginError('Oops, Unauthorized'); }
}
