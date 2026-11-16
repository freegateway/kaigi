'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const vm = require('node:vm');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const web = require('../app/src/WebDeployment');
const { peerAddress, securityEvent } = require('../app/src/SecurityEvents');
const { installConnectionSecurity } = require('../app/src/ConnectionSecurity');
const { checkPlans } = require('../app/src/StartupSafety');
const source = fs.readFileSync(require.resolve('../app/src/Server'), 'utf8');
const publicHeaders = { host: 'meet.example', 'x-forwarded-for': '192.0.2.10', 'x-forwarded-proto': 'https' };
const proxyEnv = { WEB_MODE: 'proxy', WEB_URL: 'https://meet.example', WEB_LISTEN_IP: '127.0.0.1', WEB_PROXY_IPS: '127.0.0.1' };

describe('explicit web deployment boundary', function () {
    this.timeout(6000);
    it('derives private named-instance sockets without changing direct or TCP listeners', () => {
        const environment = { WEB_MODE: 'proxy', WEB_URL: 'https://meet.example', KAIGI_INSTANCE: 'staff' };
        assert.equal(web.settings(environment).socketPath, '/var/run/kaigi/staff/session/staff.socket');
        assert.equal(web.settings({ ...environment, WEB_LISTEN_SOCKET: '/run/custom.sock' }).socketPath, '/run/custom.sock');
        assert.equal(web.settings({ ...proxyEnv, KAIGI_INSTANCE: 'staff' }).socketPath, '');
        assert.equal(web.settings({ KAIGI_INSTANCE: 'staff' }).mode, 'direct');
        for (const instance of ['', '../staff', 'staff/public']) {
            assert.throws(() => web.settings({ ...environment, KAIGI_INSTANCE: instance }));
        }
    });
    it('requires exact HTTPS root deployment and an explicit trust boundary', () => {
        for (const overrides of [
            { WEB_URL: 'https://meet.example/staff' }, { WEB_URL: 'http://meet.example' },
            { WEB_PROXY_IPS: '' }, { WEB_PROXY_IPS: '127.0.0.0/8' }, { WEB_LISTEN_IP: '0.0.0.0' },
            { WEB_MODE: 'guess' }, { WEB_SOCKET_MODE: '0777' },
            { WEB_LISTEN_SOCKET: '/tmp/web.sock', WEB_PROXY_IPS: '' , WEB_LISTEN_PORT: '3000' },
        ]) assert.throws(() => web.settings({ ...proxyEnv, ...overrides }));
        assert.throws(() => web.settings({ WEB_MODE: 'direct', WEB_LISTEN_SOCKET: '/tmp/web.sock' }));
        assert.throws(() => web.settings({ TRUST_PROXY: 'true' }));
    });

    it('ignores spoofed forwarding in direct mode and rejects it from untrusted backend peers', () => {
        const req = { socket: { remoteAddress: '198.51.100.5' }, headers: { ...publicHeaders } };
        assert(web.acceptRequest(req, web.settings({})));
        assert.equal(peerAddress(req), '198.51.100.5');
        assert.equal(web.acceptRequest(req, web.settings(proxyEnv)), false);
        for (const change of [ { host: 'evil.example' }, { 'x-forwarded-for': '192.0.2.1, 192.0.2.2' },
            { 'x-forwarded-proto': 'http' }, { origin: 'https://evil.example' }, { 'x-forwarded-for': 'garbage' },
            { 'x-forwarded-prefix': '/staff' } ]) {
            assert.equal(web.acceptRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...publicHeaders, ...change } }, web.settings(proxyEnv)), false);
        }
    });

    it('attributes only validated proxy requests, including Socket.IO and security logs', () => {
        const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {
            ...publicHeaders, 'x-forwarded-host': 'evil.example', forwarded: 'for=evil' } };
        assert(web.acceptRequest(req, web.settings(proxyEnv)));
        assert.equal(peerAddress(req), '192.0.2.10');
        assert.equal(require('../app/src/middleware/RateLimiters').ipKeyGenerator(req), '192.0.2.10');
        assert.equal(peerAddress({ conn: { request: req } }), '192.0.2.10');
        assert.equal(req.headers['x-forwarded-host'], undefined);
        const saved = console.log; let line;
        try { console.log = text => { line = text; }; securityEvent('authentication_failed', req, 'invalid_credentials'); }
        finally { console.log = saved; }
        assert.equal(JSON.parse(line).ip, '192.0.2.10');
    });

    it('detects duplicate Unix allocations without inventing web TCP reservations', () => {
        const plan = (name, socket) => ({ name, workers: 1, config: '/config/' + name, recordings: '/state/' + name,
            listeners: [{ kind: 'web', protocol: 'unix', path: socket }] });
        assert.throws(() => checkPlans([plan('staff', '/run/shared.sock'), plan('public', '/run/shared.sock')]), /duplicate web socket/);
        assert.doesNotThrow(() => checkPlans([plan('staff', '/run/staff.sock'), plan('public', '/run/public.sock')], 2));
    });

    it('refuses symlinks, ordinary files and writable socket parents', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-socket-'));
        try {
            const file = path.join(dir, 'web.sock');
            fs.writeFileSync(file, 'not a socket');
            assert.throws(() => web.validateSocketPath(file));
            fs.unlinkSync(file); fs.symlinkSync(path.join(dir, 'missing'), file);
            assert.throws(() => web.validateSocketPath(file));
            const linkedParent = path.join(dir, 'linked-parent');
            fs.symlinkSync(path.join(dir, 'missing-parent'), linkedParent);
            assert.throws(() => web.validateSocketPath(path.join(linkedParent, 'web.sock')));
            fs.unlinkSync(file); fs.chmodSync(dir, 0o777);
            assert.throws(() => web.validateSocketPath(file));
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    for (const unix of [false, true]) it(`serves real HTTP and authenticated WebSockets over ${unix ? 'a private Unix socket' : 'a trusted TCP backend'}`, async function () {
        // Explicit opt-out for restricted development sandboxes only. FreeBSD
        // validation must run this test with the variable unset.
        if (unix && process.env.KAIGI_SKIP_UNIX_TESTS === '1') this.skip();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-uds-'));
        const socketPath = path.join(dir, 'web.sock');
        const deployment = web.settings(unix ? { WEB_MODE: 'proxy', WEB_URL: 'https://meet.example', WEB_LISTEN_SOCKET: socketPath } : proxyEnv);
        const server = http.createServer((req, res) => {
            if (!web.acceptRequest(req, deployment)) { res.writeHead(403); return res.end(); }
            res.setHeader('Set-Cookie', '__Host-fixture=x; Secure; HttpOnly; Path=/');
            res.end(peerAddress(req));
        });
        const io = new Server(server, { transports: ['websocket'] });
        io.engine.use((req, res, next) => web.acceptRequest(req, deployment) ? next() : next(new Error('Forbidden')));
        const oldDeadline = process.env.SOCKET_AUTH_TIMEOUT;
        process.env.SOCKET_AUTH_TIMEOUT = '1';
        try { installConnectionSecurity(server, io, () => {}); }
        finally { if (oldDeadline === undefined) delete process.env.SOCKET_AUTH_TIMEOUT; else process.env.SOCKET_AUTH_TIMEOUT = oldDeadline; }
        const first = source.indexOf('    io.use((socket, next) => {');
        const last = source.indexOf("    io.on('connection'", first);
        vm.runInNewContext(source.slice(first, last), { io, securityEvent() {}, authenticatedSession(token) {
            if (token !== 'live-token') throw Error('revoked or missing');
            return { id: 'live-session' };
        } });
        io.on('connection', socket => { socket.emit('fixture', { ip: peerAddress(socket), session: socket.authSessionId }); });
        const clients = [];
        const originalMask = process.umask();
        try {
            web.prepareListener(deployment);
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(unix ? { path: socketPath } : { host: '127.0.0.1', port: 0 }, resolve); });
            web.listenerReady(deployment);
            if (unix) {
                assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
                assert.throws(() => web.prepareListener(deployment)); // Never unlink a live or stale socket.
            }
            const endpoint = unix ? { socketPath } : { host: '127.0.0.1', port: server.address().port };
            const response = await new Promise((resolve, reject) => {
                http.get({ ...endpoint, path: '/', headers: publicHeaders }, res => {
                    let body = ''; res.on('data', data => body += data); res.on('end', () => resolve({ body, res }));
                }).on('error', reject);
            });
            assert.equal(response.body, '192.0.2.10');
            assert.match(response.res.headers['set-cookie'][0], /Secure/);
            const noHeaders = await new Promise((resolve, reject) => http.get({ ...endpoint, path: '/' }, res => {
                res.resume(); resolve(res.statusCode);
            }).on('error', reject));
            assert.equal(noHeaders, 403);
            const connect = () => {
                const client = new WebSocket('ws://meet.example/socket.io/?EIO=4&transport=websocket', {
                    createConnection: () => unix ? net.connect(socketPath) : net.connect(endpoint.port, endpoint.host), headers: publicHeaders,
                });
                clients.push(client); return client;
            };
            const ws = connect();
            const payload = await new Promise((resolve, reject) => {
                ws.on('error', reject);
                ws.on('message', raw => {
                    const packet = String(raw);
                    if (packet.startsWith('0')) ws.send('40{"token":"live-token"}');
                    else if (packet === '2') ws.send('3');
                    else if (packet.startsWith('42')) resolve(JSON.parse(packet.slice(2))[1]);
                });
            });
            assert.deepEqual(payload, { ip: '192.0.2.10', session: 'live-session' });
            const rejected = connect();
            await new Promise((resolve, reject) => {
                rejected.on('error', reject);
                rejected.on('message', raw => {
                    const packet = String(raw);
                    if (packet.startsWith('0')) rejected.send('40{"token":"revoked-token"}');
                    else if (packet.startsWith('44')) { assert.match(packet, /Authentication required/); resolve(); }
                });
            });
            const silent = connect();
            await new Promise((resolve, reject) => { silent.on('error', reject); silent.on('close', resolve); });
            assert.equal(ws.readyState, WebSocket.OPEN);
        } finally {
            clients.forEach(client => client.terminate());
            await new Promise(resolve => io.close(resolve));
            process.umask(originalMask);
            assert.equal(fs.existsSync(socketPath), false);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
