'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadInstanceConfiguration, resolvePath } = require('../app/src/PathPolicy');
const { checkPlans } = require('../app/src/StartupSafety');
const { cleanEnvironment } = require('../app/src/StartupEnvironment');
const { diagnose, formatDiagnostic } = require('../app/src/StartupDiagnostics');

describe('configurable instance symlink policy', function () {
    this.timeout(15000);
    let root, config, state, alias, environment;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-path-policy-'));
        config = path.join(root, 'config/staff'); state = path.join(root, 'state/staff');
        fs.mkdirSync(config, { recursive: true }); fs.mkdirSync(state, { recursive: true });
        alias = path.join(root, 'etc-kaigi'); fs.symlinkSync(path.dirname(config), alias);
        fs.writeFileSync(path.join(config, 'users'), 'example|password|Example|["approved"]', { mode: 0o600 });
        environment = cleanEnvironment({ PATH: process.env.PATH, KAIGI_INSTANCE: 'staff',
            KAIGI_CONFIG_DIR: path.join(alias, 'staff'), KAIGI_STATE_DIR: state });
        configure();
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    function configure(option = '', extra = '') {
        fs.writeFileSync(path.join(config, 'kaigi.conf'), `WEB_MODE=proxy\nWEB_URL=https://example.invalid\nWEB_LISTEN_SOCKET=${root}/staff.socket\nMEDIA_MIN_PORT=40000\nMEDIA_MAX_PORT=40100\nMEDIA_NUM_WORKERS=1\nMEDIA_ANNOUNCED_IP=127.0.0.1\n${option}\n${extra}\n`);
    }
    function load() {
        return spawnSync(process.execPath, ['-e', 'const c=require("./app/src/config"); console.log(JSON.stringify({config:c.runtimePaths.configDirectory,state:c.runtimePaths.stateDirectory,recordings:c.media.recording.dir}))'],
            { cwd: path.resolve(__dirname, '..'), env: environment, encoding: 'utf8', timeout: 5000 });
    }
    function inspect() {
        return spawnSync(process.execPath, ['app/src/StartupSafety.js', 'inspect', 'staff', environment.KAIGI_CONFIG_DIR,
            environment.KAIGI_STATE_DIR, os.userInfo().username, String(os.userInfo().gid)],
        { cwd: path.resolve(__dirname, '..'), env: environment, encoding: 'utf8', timeout: 5000 });
    }
    it('denies linked configuration ancestors by default and reports the exact link and override', () => {
        for (const option of ['', 'ALLOW_SYMLINKS=false']) {
            configure(option);
            assert.throws(() => loadInstanceConfiguration(environment), error => {
                const text = formatDiagnostic(diagnose(error, 'paths', 'instance paths'));
                assert(text.includes(JSON.stringify(alias))); assert.match(text, /ALLOW_SYMLINKS=true/); return true;
            });
            assert.notEqual(load().status, 0);
            const result = inspect(); assert.notEqual(result.status, 0);
            assert.match(formatDiagnostic(JSON.parse(result.stderr)), /ALLOW_SYMLINKS=true/);
        }
    });
    it('loads quoted/interpolated policy consistently in preflight and the production configuration loader', () => {
        configure('ALLOW_SYMLINKS="${ENABLE_LINKS}"\nENABLE_LINKS=true');
        const result = inspect(); assert.equal(result.status, 0, result.stderr);
        const plan = JSON.parse(result.stdout); assert.equal(plan.config, config); assert.equal(plan.state, state);
        const runtime = load(); assert.equal(runtime.status, 0, runtime.stderr);
        assert.deepEqual(JSON.parse(runtime.stdout), { config, state, recordings: path.join(state, 'recordings') });
        const receipt = path.join(root, 'launch-plan.json'); fs.writeFileSync(receipt, result.stdout, { mode: 0o600 });
        for (const kind of ['config', 'state']) {
            const extracted = spawnSync(process.execPath, ['app/src/StartupSafety.js', 'path', receipt, kind],
                { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
            assert.equal(extracted.status, 0, extracted.stderr); assert.equal(extracted.stdout, plan[kind]);
        }
    });
    it('rejects invalid, duplicate and circular options rather than accepting environment overrides', () => {
        for (const option of ['ALLOW_SYMLINKS=yes', 'ALLOW_SYMLINKS=', 'ALLOW_SYMLINKS=TRUE',
            'ALLOW_SYMLINKS=true\nALLOW_SYMLINKS=false', 'ALLOW_SYMLINKS=${ALLOW_SYMLINKS}']) {
            configure(option); assert.notEqual(load().status, 0); assert.notEqual(inspect().status, 0);
        }
        configure('ALLOW_SYMLINKS=yes');
        const diagnostic = formatDiagnostic(JSON.parse(inspect().stderr)); assert.match(diagnostic, /ALLOW_SYMLINKS.*true or false/);
        configure(); environment.ALLOW_SYMLINKS = 'true'; assert.notEqual(load().status, 0);
    });
    it('resolves state and recording aliases, including missing descendants, and rejects recording escapes', () => {
        configure('ALLOW_SYMLINKS=true');
        const stateAlias = path.join(root, 'state-alias'); fs.symlinkSync(state, stateAlias); environment.KAIGI_STATE_DIR = stateAlias;
        let runtime = load(); assert.equal(runtime.status, 0, runtime.stderr);
        assert.equal(JSON.parse(runtime.stdout).state, state);
        fs.mkdirSync(path.join(state, 'storage')); fs.symlinkSync(path.join(state, 'storage'), path.join(state, 'recordings'));
        runtime = load(); assert.equal(runtime.status, 0, runtime.stderr);
        assert.equal(JSON.parse(runtime.stdout).recordings, path.join(state, 'storage'));
        configure('ALLOW_SYMLINKS=true', `RECORDING_DIR=${stateAlias}/storage/new`);
        runtime = load(); assert.equal(runtime.status, 0, runtime.stderr);
        assert.equal(JSON.parse(runtime.stdout).recordings, path.join(state, 'storage/new'));
        fs.unlinkSync(path.join(state, 'recordings')); fs.symlinkSync(root, path.join(state, 'recordings'));
        configure('ALLOW_SYMLINKS=true'); assert.notEqual(load().status, 0); assert.notEqual(inspect().status, 0);
    });
    it('detects cross-instance path overlap concealed by aliases, including state roots and absent descendants', () => {
        const other = path.join(root, 'other-state'); fs.symlinkSync(state, other);
        const plan = (name, dir) => ({ name, config: path.join(root, name), state: dir,
            recordings: path.join(dir, name, 'missing'), workers: 1, listeners: [] });
        assert.throws(() => checkPlans([plan('one', state), plan('two', other)]), /overlapping configuration\/state paths/);
        const one = plan('one', state), two = plan('two', path.join(root, 'separate'));
        one.config = config; two.config = path.join(alias, 'staff');
        assert.throws(() => checkPlans([one, two]), /overlapping configuration\/state paths/);
        assert.equal(resolvePath(path.join(other, 'not-created/child')), path.join(state, 'not-created/child'));
    });
    it('rejects two real preflight inspectors whose different state aliases resolve to one allocation', () => {
        configure('ALLOW_SYMLINKS=true');
        const publicConfig = path.join(root, 'config/public'); fs.mkdirSync(publicConfig);
        fs.copyFileSync(path.join(config, 'users'), path.join(publicConfig, 'users'));
        fs.writeFileSync(path.join(publicConfig, 'kaigi.conf'), fs.readFileSync(path.join(config, 'kaigi.conf'), 'utf8')
            .replace('staff.socket', 'public.socket').replace('40000', '40200').replace('40100', '40300'));
        fs.symlinkSync(state, path.join(root, 'state/public'));
        const run = path.join(root, 'run'); fs.mkdirSync(run);
        const identity = [os.userInfo().username, String(os.userInfo().gid)];
        const result = spawnSync(process.execPath, ['app/src/StartupSafety.js', 'preflight', alias,
            path.join(root, 'state'), run, 'staff', 'start', 'staff', ...identity, 'public', ...identity],
        { cwd: path.resolve(__dirname, '..'), env: cleanEnvironment({ PATH: process.env.PATH }), encoding: 'utf8', timeout: 10000 });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /overlapping configuration\/state paths/);
        assert(!fs.existsSync(path.join(run, 'preflight.json')));
    });
    it('rejects dangling links, loops, non-directory roots and unsafe resolved target permissions', () => {
        configure('ALLOW_SYMLINKS=true');
        const bad = path.join(root, 'bad'); environment.KAIGI_STATE_DIR = path.join(bad, 'missing');
        fs.symlinkSync(path.join(root, 'gone'), bad); assert.notEqual(load().status, 0);
        fs.unlinkSync(bad); fs.symlinkSync(bad, bad); assert.notEqual(load().status, 0);
        fs.unlinkSync(bad); fs.writeFileSync(bad, 'file'); assert.notEqual(load().status, 0);
        fs.unlinkSync(bad); fs.symlinkSync(state, bad); fs.chmodSync(state, 0o777); assert.notEqual(load().status, 0);
    });
    it('keeps regular-file and credential protections when directory symlinks are enabled', () => {
        configure('ALLOW_SYMLINKS=true');
        const users = path.join(config, 'users'); fs.chmodSync(users, 0o666); assert.notEqual(inspect().status, 0);
        fs.chmodSync(users, 0o600); fs.renameSync(users, users + '.real'); fs.symlinkSync(users + '.real', users);
        assert.notEqual(inspect().status, 0);
        fs.unlinkSync(users); fs.renameSync(users + '.real', users);
        const filename = path.join(config, 'kaigi.conf'); fs.renameSync(filename, filename + '.real'); fs.symlinkSync(filename + '.real', filename);
        assert.notEqual(load().status, 0);
        fs.unlinkSync(filename); fs.renameSync(filename + '.real', filename); fs.chmodSync(filename, 0o666); assert.notEqual(load().status, 0);
    });
    it('does not turn the policy into permission to link runtime metadata or Unix socket parents', () => {
        configure('ALLOW_SYMLINKS=true');
        const real = path.join(root, 'metadata'); fs.writeFileSync(real, '{}', { mode: 0o600 });
        const linked = path.join(root, 'metadata-link'); fs.symlinkSync(real, linked);
        const result = spawnSync(process.execPath, ['app/src/StartupSafety.js', 'path', linked, 'config'],
            { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: environment });
        assert.notEqual(result.status, 0);
        const parent = path.join(root, 'socket-parent'); fs.symlinkSync(root, parent);
        configure('ALLOW_SYMLINKS=true', `WEB_LISTEN_SOCKET=${parent}/meeting.socket`);
        assert.notEqual(inspect().status, 0);
    });
});
