'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const { instancePaths } = require('../app/src/InstancePaths');
const root = path.resolve(__dirname, '..');

describe('instance boundaries', function () {
    this.timeout(30000);

    it('requires an explicit name and roots for every instance, without special names', () => {
        assert.throws(() => instancePaths({}), /KAIGI_INSTANCE/);
        assert.throws(() => instancePaths({ KAIGI_INSTANCE: 'staff' }), /KAIGI_CONFIG_DIR/);
        assert.throws(() => instancePaths({ KAIGI_INSTANCE: 'staff', KAIGI_CONFIG_DIR: '/config/staff' }), /KAIGI_STATE_DIR/);
        for (const name of ['../staff', 'staff-public', 'Staff', 'a'.repeat(33)]) {
            assert.throws(() => instancePaths({ KAIGI_INSTANCE: name }), /Invalid KAIGI_INSTANCE/);
        }
        const staff = instancePaths({ KAIGI_INSTANCE: 'staff', KAIGI_CONFIG_DIR: '/config/staff', KAIGI_STATE_DIR: '/state/staff' });
        assert.equal(staff.siteAssets, '/config/staff/site-assets');
        assert.equal(staff.recordingDirectory(), '/state/staff/recordings');
        assert.equal(staff.recordingDirectory('local'), '/state/staff/local');
        assert.throws(() => staff.recordingDirectory('../public'), /inside KAIGI_STATE_DIR/);
        assert.throws(() => staff.recordingDirectory('/state/public'), /inside KAIGI_STATE_DIR/);
        const ordinary = instancePaths({ KAIGI_INSTANCE: 'default', KAIGI_CONFIG_DIR: '/config/instances/default', KAIGI_STATE_DIR: '/state/default' });
        assert.equal(ordinary.navigationCookie, '__Host-kaigi_default_session');
        assert.equal(ordinary.recordingDirectory(), '/state/default/recordings');
    });

    it('does not fall back to default configuration for a missing named configuration', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-missing-instance-'));
        try {
            const result = spawnSync(process.execPath, ['-e', "require('./app/src/config')"], {
                cwd: root, encoding: 'utf8',
                env: { ...process.env, KAIGI_INSTANCE: 'missing', KAIGI_CONFIG_DIR: directory, KAIGI_STATE_DIR: path.join(directory, 'state') },
            });
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /Required configuration file is missing/);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });

    it('rejects implicit or malformed named-instance socket allocations', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-instance-ports-'));
        const valid = ['WEB_LISTEN_PORT=7443', 'WEB_URL=https://example.invalid:7443', 'MEDIA_MIN_PORT=40000', 'MEDIA_MAX_PORT=40100', 'MEDIA_NUM_WORKERS=2'];
        function load(lines) {
            fs.writeFileSync(path.join(directory, 'kaigi.conf'), lines.join('\n'));
            return spawnSync(process.execPath, ['-e', "require('./app/src/config')"], {
                cwd: root, encoding: 'utf8',
                env: { PATH: process.env.PATH, KAIGI_INSTANCE: 'staff', KAIGI_CONFIG_DIR: directory,
                    KAIGI_STATE_DIR: path.join(directory, 'state'), SFU_ANNOUNCED_IP: '127.0.0.1' },
            });
        }
        try {
            assert.equal(load(valid).status, 0);
            for (const name of ['WEB_LISTEN_PORT', 'WEB_URL', 'MEDIA_MIN_PORT', 'MEDIA_MAX_PORT']) {
                assert.notEqual(load(valid.filter(line => !line.startsWith(name + '='))).status, 0, name);
            }
            for (const entry of ['WEB_LISTEN_PORT=7443junk', 'MEDIA_MIN_PORT=65536', 'MEDIA_MAX_PORT=39999', 'WEB_LISTEN_PORT=40001', 'RECORDING_DIR=../other', 'KAIGI_CONFIG_DIR=/other']) {
                const name = entry.split('=')[0];
                assert.notEqual(load([...valid.filter(line => !line.startsWith(name + '=')), entry]).status, 0, entry);
            }
            assert.notEqual(load([...valid, 'SFU_SERVER=true', 'MEDIA_NUM_WORKERS=4', 'MEDIA_MAX_PORT=40001']).status, 0);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });

    it('never falls back to a package-wide site-assets link when an instance asset is missing', async () => {
        const express = require('express');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-instance-assets-'));
        const own = path.join(directory, 'own'), legacy = path.join(directory, 'public/site-assets');
        fs.mkdirSync(own, { recursive: true });
        fs.mkdirSync(legacy, { recursive: true });
        fs.writeFileSync(path.join(legacy, 'other-site.txt'), 'other site');
        const app = express();
        app.use('/site-assets', require('../app/src/middleware/SiteAssets')(own));
        app.use(express.static(path.join(directory, 'public')));
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
            const status = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${server.address().port}/site-assets/other-site.txt`, response => {
                    response.resume(); response.on('end', () => resolve(response.statusCode));
                }).on('error', reject);
            });
            assert.equal(status, 404);
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('isolates branding, navigation, grants, tokens, logout and process shutdown across two live servers', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-live-instances-'));
        const children = [];
        const sockets = [];
        async function request(port, route, body, headers = {}) {
            if (headers.token) {
                headers = { ...headers, Authorization: `Bearer ${headers.token}` };
                delete headers.token;
            }
            return new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port, path: route, method: body === undefined ? 'GET' : 'POST',
                    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } }, res => {
                    let text = '';
                    res.setEncoding('utf8');
                    res.on('data', chunk => text += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text,
                        json() { return JSON.parse(text); } }));
                });
                req.on('error', reject);
                req.end(body === undefined ? undefined : JSON.stringify(body));
            });
        }
        async function start(name) {
            const reserve = http.createServer();
            reserve.listen(0, '127.0.0.1');
            await once(reserve, 'listening');
            const port = reserve.address().port;
            await new Promise(resolve => reserve.close(resolve));
            const config = path.join(directory, name);
            let mediaMin = name === 'staff' ? 10000 : 10200;
            if (port >= mediaMin && port <= mediaMin + 100) mediaMin += 1000;
            fs.mkdirSync(path.join(config, 'site-assets'), { recursive: true });
            fs.writeFileSync(path.join(config, 'site-assets', 'logo.txt'), name);
            fs.writeFileSync(path.join(config, 'site-translations.json'), JSON.stringify({ en: { SITE_DESCRIPTION: `${name} description` } }));
            fs.writeFileSync(path.join(config, 'meeting-properties.json'), JSON.stringify({ [name]: { names: { en: `${name} meeting` }, restrictions: [] } }));
            fs.writeFileSync(path.join(config, 'kaigi.conf'), [
                `WEB_LISTEN_PORT=${port}`, 'WEB_LISTEN_IP=127.0.0.1', 'MEDIA_ANNOUNCED_IP=127.0.0.1',
                `WEB_URL=https://127.0.0.1:${port}`, `MEDIA_MIN_PORT=${mediaMin}`, `MEDIA_MAX_PORT=${mediaMin + 100}`,
                'MEDIA_NUM_WORKERS=1', 'HOST_PROTECTED=true', 'HOST_USER_AUTH=true',
                `SITE_NAME=${name}`, 'RECORDING_ENABLED=true',
            ].join('\n'));
            const child = spawn(process.execPath, ['tests/fixtures/instance-server.cjs'], {
                cwd: root, env: { PATH: process.env.PATH, KAIGI_INSTANCE: name, KAIGI_CONFIG_DIR: config,
                    KAIGI_READY_FILE: path.join(config, 'ready.json'), KAIGI_STARTUP_NONCE: name,
                    KAIGI_STATE_DIR: path.join(directory, 'state', name),
                    JWT_SECRET: `${name}-tests-only-012345678901234567890123456789`,
                    HOST_USERS: `${name}|password|${name}|["${name}"]` },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            children.push(child);
            let output = '';
            child.stdout.on('data', chunk => output += chunk);
            child.stderr.on('data', chunk => output += chunk);
            for (let attempt = 0; attempt < 200; attempt++) {
                if (child.exitCode !== null) throw Error(`Instance exited: ${output}`);
                try {
                    if ((await request(port, '/')).status === 200) {
                        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config, 'ready.json'), 'utf8')), { pid: child.pid, nonce: name });
                        return { port, child };
                    }
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw Error(`Instance failed to start: ${output}`);
        }
        async function handshake(port, token) {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
            sockets.push(socket);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { socket.terminate(); reject(Error('Handshake timeout')); }, 3000);
                socket.on('error', error => { clearTimeout(timer); reject(error); });
                socket.on('message', raw => {
                    const frame = String(raw);
                    if (frame.startsWith('0')) socket.send('40' + JSON.stringify({ token }));
                    else if (frame === '2') socket.send('3');
                    else if (frame.startsWith('40') || frame.startsWith('44')) {
                        clearTimeout(timer);
                        resolve({ socket, accepted: frame.startsWith('40') });
                    }
                });
            });
        }
        try {
            const staff = await start('staff'), publicSite = await start('public');
            for (const [server, name] of [[staff, 'staff'], [publicSite, 'public']]) {
                assert.match((await request(server.port, '/')).text, new RegExp(name));
                assert.match((await request(server.port, '/')).text, new RegExp(`${name} description`));
                assert.equal((await request(server.port, '/')).status, 200);
                assert.equal((await request(server.port, '/')).headers['cache-control'], 'no-store');
                assert.equal((await request(server.port, '/login')).status, 404);
                assert.equal((await request(server.port, '/login', { username: name, password: 'password' })).status, 404);
                assert.equal((await request(server.port, '/site-assets/logo.txt')).text, name);
                assert.equal((await request(server.port, '/site-assets/missing.txt')).status, 404);
                assert.equal((await request(server.port, '/%73ite-assets/logo.txt')).status, 404);
                assert.equal((await request(server.port, '/site-assets/%2e%2e/users')).status, 404);
                assert(fs.existsSync(path.join(directory, 'state', name, 'recordings')));
            }
            const a = await request(staff.port, '/auth/session/login', { username: 'staff', password: 'password' });
            const b = await request(publicSite.port, '/auth/session/login', { username: 'public', password: 'password' });
            assert.equal(a.status, 200); assert.equal(b.status, 200);
            assert.deepEqual(a.json().meetingTranslations, { staff: { en: 'staff meeting' } });
            assert.deepEqual(b.json().meetingTranslations, { public: { en: 'public meeting' } });
            const aToken = a.json().message, bToken = b.json().message;
            assert.equal((await request(publicSite.port, '/auth/session/login', { username: 'staff', password: 'password' })).status, 401);
            const aCookie = a.headers['set-cookie'][0].split(';')[0];
            const bCookie = b.headers['set-cookie'][0].split(';')[0];
            assert.match(aCookie, /^__Host-kaigi_staff_session=/);
            assert.match(bCookie, /^__Host-kaigi_public_session=/);
            const jar = `${aCookie}; ${bCookie}`;
            const selected = await request(publicSite.port, '/auth/meeting/select', { meeting: 'public' }, { token: bToken });
            assert.equal(selected.status, 200);
            assert.equal((await request(publicSite.port, selected.json().navigation, undefined, { Cookie: jar })).status, 200);
            assert.equal((await request(staff.port, '/auth/meeting/select', { meeting: 'public' }, { token: aToken })).status, 403);
            assert.equal((await request(publicSite.port, '/auth/session/touch', {}, { token: aToken })).status, 401);
            assert.equal((await handshake(publicSite.port, aToken)).accepted, false);
            const active = await handshake(publicSite.port, bToken);
            assert(active.accepted);
            const logout = await request(staff.port, '/auth/session/logout', {}, { token: aToken, Cookie: jar });
            assert.match(logout.headers['set-cookie'][0], /^__Host-kaigi_staff_session=;/);
            assert.equal((await request(staff.port, '/auth/session/touch', {}, { token: aToken })).status, 401);
            assert.equal((await request(publicSite.port, '/auth/session/touch', {}, { token: bToken })).status, 200);
            staff.child.kill('SIGTERM');
            await once(staff.child, 'exit');
            assert.equal(staff.child.exitCode, 0);
            assert.equal(active.socket.readyState, WebSocket.OPEN);
            assert.equal((await request(publicSite.port, '/auth/session/touch', {}, { token: bToken })).status, 200);
        } finally {
            for (const socket of sockets) socket.terminate();
            for (const child of children) {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGTERM');
                    await once(child, 'exit');
                }
            }
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
