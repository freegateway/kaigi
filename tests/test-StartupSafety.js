'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { addressOverlaps, checkPlans, noSymlinks } = require('../app/src/StartupSafety');
const { cleanEnvironment } = require('../app/src/StartupEnvironment');
const helper = path.resolve(__dirname, '../app/src/StartupSafety.js');

describe('startup safety preflight', function () {
    this.timeout(30000);
    function fixture() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-preflight-'));
        const config = path.join(root, 'config'), state = path.join(root, 'state'), run = path.join(root, 'run');
        fs.mkdirSync(run);
        function configure(name, options = {}) {
            const directory = path.join(config, name);
            fs.mkdirSync(directory, { recursive: true });
            fs.mkdirSync(path.join(state, name), { recursive: true });
            const values = { WEB_LISTEN_IP: '127.0.0.1', WEB_LISTEN_PORT: name === 'staff' ? 7443 : 8443,
                WEB_URL: 'https://example.invalid', MEDIA_ANNOUNCED_IP: '127.0.0.1',
                MEDIA_MIN_PORT: name === 'staff' ? 40000 : 40200, MEDIA_MAX_PORT: name === 'staff' ? 40100 : 40300,
                MEDIA_NUM_WORKERS: 1, ...options };
            fs.writeFileSync(path.join(directory, 'kaigi.conf'), Object.entries(values).filter(([,value]) => value !== undefined).map(([key,value]) => `${key}=${value}`).join('\n'));
            fs.writeFileSync(path.join(directory, 'users'), 'example|password|Example|["approved"]\n', { mode: 0o600 });
        }
        configure('staff'); configure('public');
        function check(extra = {}, selected = 'staff', operation = 'start') {
            return spawnSync(process.execPath, [helper, 'preflight', config, state, run, selected, operation,
                'staff', os.userInfo().username, String(os.userInfo().gid), 'public', os.userInfo().username, String(os.userInfo().gid)], {
                encoding: 'utf8', env: cleanEnvironment({ PATH: process.env.PATH, ...extra }), timeout: 20000,
            });
        }
        return { root, config, state, run, configure, check, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
    }
    it('compares IPv4, wildcard, IPv6 and mapped addresses conservatively', () => {
        assert(addressOverlaps('0.0.0.0', '127.0.0.1'));
        assert(addressOverlaps('::', '127.0.0.1'));
        assert(addressOverlaps('::ffff:127.0.0.1', '127.0.0.1'));
        assert(addressOverlaps('0:0:0:0:0:0:0:1', '::1'));
        assert(!addressOverlaps('127.0.0.1', '127.0.0.2'));
        assert(!addressOverlaps('::1', '127.0.0.1'));
    });
    it('preflights Unix proxy allocations without TLS files or web TCP reservations', () => {
        const f = fixture();
        try {
            const common = { WEB_MODE: 'proxy', WEB_LISTEN_IP: undefined, WEB_LISTEN_PORT: undefined,
                WEB_SSL_CERT: '/missing/cert', WEB_SSL_KEY: '/missing/key' };
            f.configure('staff', { ...common, WEB_LISTEN_SOCKET: path.join(f.run, 'staff.sock') });
            f.configure('public', { ...common, WEB_LISTEN_SOCKET: path.join(f.run, 'public.sock') });
            const result = f.check();
            assert.equal(result.status, 0, result.stderr);
            const plans = JSON.parse(fs.readFileSync(path.join(f.run, 'preflight.json')));
            assert(plans.every(plan => plan.listeners.find(item => item.kind === 'web').protocol === 'unix'));
            f.configure('public', { ...common, WEB_LISTEN_SOCKET: path.join(f.run, 'staff.sock') });
            assert.match(f.check().stderr, /duplicate web socket/);
            f.configure('public', { ...common, WEB_LISTEN_SOCKET: path.join(f.run, 'public.sock'), MEDIA_MIN_PORT: 40100 });
            assert.match(f.check().stderr, /overlapping/);
        } finally { f.cleanup(); }
    });
    it('rejects every overlap class, including inclusive range endpoints', () => {
        const plan = (name, kind, min, max = min, ip = '127.0.0.1') => ({ name, config: `/config/${name}`,
            recordings: `/state/${name}`, workers: 1, listeners: [{ kind, min, max, ip, protocol: 'tcp' }] });
        for (const kinds of [['web','web'], ['web','media'], ['media','web'], ['media','media']]) {
            assert.throws(() => checkPlans([plan('staff', kinds[0], 40000, 40100), plan('public', kinds[1], 40100, 40200)]), /overlapping tcp/);
        }
        assert.doesNotThrow(() => checkPlans([plan('staff', 'media', 40000, 40100), plan('public', 'media', 40101, 40200)]));
        assert.doesNotThrow(() => checkPlans([plan('staff', 'media', 40000), plan('public', 'media', 40000, 40000, '127.0.0.2')]));
        assert.match(checkPlans([plan('staff', 'media', 40000), plan('public', 'media', 40200)], 1), /worker total/);
    });
    it('checks all configured instances, not only the selected one; rejects web/media collisions', () => {
        const f = fixture();
        try {
            assert.equal(f.check().status, 0);
            f.configure('public', { MEDIA_MIN_PORT: 40100, MEDIA_MAX_PORT: 40200 });
            const conflict = f.check();
            assert.notEqual(conflict.status, 0);
            assert.match(conflict.stderr, /staff and public.*overlapping/);
            f.configure('public', { WEB_LISTEN_PORT: 40001 });
            assert.notEqual(f.check().status, 0);
            f.configure('public', { WEB_LISTEN_PORT: 7443, WEB_LISTEN_IP: '0.0.0.0' });
            assert.notEqual(f.check().status, 0);
        } finally { f.cleanup(); }
    });
    it('ignores caller configuration overrides', () => {
        const f = fixture();
        try {
            const result = f.check({ SERVER_LISTEN_PORT: '8443', RECORDING_DIR: '/wrong', SFU_MIN_PORT: '40200', NODE_OPTIONS: '--not-a-node-option' });
            assert.equal(result.status, 0, result.stderr);
            const plans = JSON.parse(fs.readFileSync(path.join(f.run, 'preflight.json'), 'utf8'));
            assert.equal(plans[0].listeners[0].ip, '127.0.0.1');
            assert.equal(plans[0].listeners[0].min, 7443);
        } finally { f.cleanup(); }
    });
    it('reports useful child-process diagnostics without leaking configuration values', () => {
        const f = fixture();
        try {
            f.configure('staff', { MEDIA_MAX_PORT: 39999 });
            let result = f.check();
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /Instance staff: configuration validation failed \(kaigi.conf\).*MEDIA_MAX_PORT must not be below MEDIA_MIN_PORT/);
            f.configure('staff');
            fs.appendFileSync(path.join(f.config, 'staff/kaigi.conf'), '\nPASSWORD=do-not-print-this\nBAD LINE do-not-print-this');
            result = f.check();
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /kaigi.conf, line \d+.*expected SETTING=value/);
            assert.ok(!result.stderr.includes('do-not-print-this'));
            f.configure('staff', { LDAP_ENABLED: 'true' });
            result = f.check();
            assert.match(result.stderr, /ldap\/ldap.conf.*file is missing/);
            fs.unlinkSync(path.join(f.config, 'staff/users'));
            result = f.check();
            assert.match(result.stderr, /Instance staff: credentials validation failed \(users\): file is missing/);
        } finally { f.cleanup(); }
    });
    it('never treats top-level configuration as an instance fallback', () => {
        const f = fixture();
        try {
            fs.copyFileSync(path.join(f.config, 'staff/kaigi.conf'), path.join(f.config, 'kaigi.conf'));
            fs.copyFileSync(path.join(f.config, 'staff/users'), path.join(f.config, 'users'));
            fs.unlinkSync(path.join(f.config, 'staff/kaigi.conf'));
            assert.notEqual(f.check().status, 0);
        } finally { f.cleanup(); }
    });
    it('shares hostname resolution and rejects ambiguous local addresses (injected DNS/interface fixtures)', async () => {
        const resolve = require('../app/src/NetworkConfig').configureFreeBSDNetwork;
        const config = { server: { listen: { ip: '0.0.0.0' } }, mediasoup: {
            webRtcServerOptions: { listenInfos: [{ ip: '0.0.0.0' }] }, webRtcTransport: { listenInfos: [{ ip: '0.0.0.0' }] } } };
        const options = { environment: { WEB_LISTEN_HOST: 'example.invalid' },
            lookup: async () => [{ address: '127.0.0.1' }], interfaces: () => ({ lo: [{ family: 'IPv4', address: '127.0.0.1' }] }) };
        await resolve(config, options);
        assert.equal(config.server.listen.ip, '127.0.0.1');
        assert.equal(config.mediasoup.webRtcTransport.listenInfos[0].ip, '127.0.0.1');
        assert.equal(config.mediasoup.webRtcTransport.listenInfos[0].announcedAddress, '127.0.0.1');
        await assert.rejects(() => resolve(config, { ...options, interfaces: () => ({}) }), /none is/);
    });
    it('rejects bad accounts, malformed worker counts, unreadable TLS and unsafe paths without printing credentials', () => {
        const f = fixture();
        try {
            for (const options of [{ MEDIA_NUM_WORKERS: 0 }, { MEDIA_NUM_WORKERS: '1.5' }, { MEDIA_NUM_WORKERS: '-1' },
                { WEB_URL: 'invalid' }, { CONNECTION_INITIAL_TIMEOUT: 0 }, { HTTP_HEADERS_TIMEOUT: 'bad' }, { WEB_SSL_KEY: '/missing-secret-password-value' }]) {
                f.configure('public', options);
                const result = f.check();
                assert.notEqual(result.status, 0);
                assert(!result.stderr.includes('missing-secret-password-value'));
            }
            f.configure('public');
            const invalidAccount = spawnSync(process.execPath, [helper, 'inspect', 'public', path.join(f.config, 'public'),
                path.join(f.state, 'public'), 'kaigi_no_such_test_account_69483', String(os.userInfo().gid)], {
                encoding: 'utf8', env: { PATH: process.env.PATH, KAIGI_INSTANCE: 'public', KAIGI_CONFIG_DIR: path.join(f.config, 'public'), KAIGI_STATE_DIR: path.join(f.state, 'public') },
            });
            assert.notEqual(invalidAccount.status, 0);
            fs.symlinkSync(f.state, path.join(f.state, 'public/recordings'));
            assert.notEqual(f.check().status, 0);
            assert(!fs.existsSync(path.join(f.run, 'preflight.json')));
        } finally { f.cleanup(); }
    });
    it('compares retained live allocations after configuration changes and rejects unknown old allocations', () => {
        const f = fixture();
        try {
            assert.equal(f.check().status, 0);
            const [old] = JSON.parse(fs.readFileSync(path.join(f.run, 'preflight.json'), 'utf8'));
            fs.mkdirSync(path.join(f.run, 'staff'));
            fs.writeFileSync(path.join(f.run, 'staff/kaigi.pid'), String(process.pid));
            assert.notEqual(f.check().status, 0);
            fs.writeFileSync(path.join(f.run, 'staff/launch-plan.json'), JSON.stringify({ ...old, pid: process.pid,
                started: execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8', env: { TZ: 'UTC', LC_ALL: 'C' } }).trim() }));
            f.configure('staff', { MEDIA_MIN_PORT: 41000, MEDIA_MAX_PORT: 41100 });
            f.configure('public', { MEDIA_MIN_PORT: 40000, MEDIA_MAX_PORT: 40100 });
            assert.notEqual(f.check({}, 'public').status, 0);
            assert.notEqual(f.check({}, 'staff,public', 'restart').status, 0);
            assert.equal(f.check({}, 'staff', 'restart').status, 0);
        } finally { f.cleanup(); }
    });
    it('checks readiness nonce, live PID and start identity; stale identities fail closed', () => {
        const f = fixture();
        try {
            const directory = path.join(f.run, 'staff'); fs.mkdirSync(directory);
            const pidfile = path.join(directory, 'kaigi.pid'), ready = path.join(directory, 'ready.json');
            fs.writeFileSync(pidfile, String(process.pid));
            fs.writeFileSync(path.join(directory, 'launch-plan.json'), JSON.stringify({ name: 'staff' }));
            fs.writeFileSync(ready, JSON.stringify({ pid: process.pid, nonce: 'current' }));
            const call = (...args) => spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' });
            const plans = path.join(f.run, 'plans.json');
            fs.writeFileSync(plans, JSON.stringify([{ name: 'staff' }]));
            const snapshot = path.join(directory, 'launch-plan.json');
            fs.chmodSync(snapshot, 0o666);
            assert.equal(call('save-plan', plans, 'staff', snapshot).status, 0);
            assert.equal(fs.statSync(snapshot).mode & 0o777, 0o644);
            assert.notEqual(call('ready', ready, pidfile, 'old').status, 0);
            const before = performance.now();
            assert.notEqual(call('wait', ready, pidfile, 'old', '1').status, 0);
            assert(performance.now() - before < 3000);
            assert.equal(call('ready', ready, pidfile, 'current').status, 0);
            assert.equal(call('identity', pidfile).status, 0);
            fs.writeFileSync(path.join(directory, 'launch-plan.json'), JSON.stringify({ pid: process.pid, started: 'stale' }));
            assert.notEqual(call('identity', pidfile).status, 0);
            fs.symlinkSync(f.root, path.join(directory, 'alias'));
            assert.throws(() => noSymlinks(path.join(directory, 'alias/missing')), /Symlink/);
        } finally { f.cleanup(); }
    });
    it('retains service credentials and required launch settings, not arbitrary environment overrides', () => {
        assert.deepEqual(cleanEnvironment({ JWT_SECRET: 'fixture', HOST_USERS: 'fixture', KAIGI_INSTANCE: 'staff',
            NODE_OPTIONS: '--inspect', NODE_PATH: '/other', SERVER_LISTEN_PORT: '9999', SITE_NAME: 'wrong' }),
        { JWT_SECRET: 'fixture', HOST_USERS: 'fixture', KAIGI_INSTANCE: 'staff' });
    });
    it('never reports readiness when worker initialization fails (full server, worker test double)', () => {
        const f = fixture();
        try {
            const ready = path.join(f.run, 'ready.json');
            const result = spawnSync(process.execPath, ['tests/fixtures/instance-server.cjs'], {
                cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000,
                env: { PATH: process.env.PATH, KAIGI_INSTANCE: 'staff',
                    KAIGI_CONFIG_DIR: path.join(f.config, 'staff'), KAIGI_STATE_DIR: path.join(f.state, 'staff'),
                    JWT_SECRET: 'fixture-never-deploy-012345678901234567890', HOST_USERS: 'example|password|Example|["approved"]',
                    KAIGI_READY_FILE: ready, KAIGI_STARTUP_NONCE: 'fixture', KAIGI_TEST_WORKER_FAIL: '1' },
            });
            assert.equal(result.status, 1, result.stderr);
            assert(!fs.existsSync(ready));
        } finally { f.cleanup(); }
    });
    it('never reports readiness if the HTTP listener cannot bind (real socket, worker test double)', async () => {
        const http = require('node:http'), server = http.createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const f = fixture();
        try {
            const port = server.address().port;
            const min = port >= 10000 && port <= 10100 ? 20000 : 10000;
            f.configure('staff', { WEB_LISTEN_PORT: port, MEDIA_MIN_PORT: min, MEDIA_MAX_PORT: min + 100 });
            const ready = path.join(f.run, 'ready.json');
            const result = spawnSync(process.execPath, ['tests/fixtures/instance-server.cjs'], {
                cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000,
                env: { PATH: process.env.PATH, KAIGI_INSTANCE: 'staff',
                    KAIGI_CONFIG_DIR: path.join(f.config, 'staff'), KAIGI_STATE_DIR: path.join(f.state, 'staff'),
                    JWT_SECRET: 'fixture-never-deploy-012345678901234567890', HOST_USERS: 'example|password|Example|["approved"]',
                    KAIGI_READY_FILE: ready, KAIGI_STARTUP_NONCE: 'fixture' },
            });
            assert.notEqual(result.status, null);
            assert.match(result.stdout + result.stderr, /EADDRINUSE/);
            assert(!fs.existsSync(ready));
        } finally { await new Promise(resolve => server.close(resolve)); f.cleanup(); }
    });
});
