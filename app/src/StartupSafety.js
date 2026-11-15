'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync, execFileSync } = require('node:child_process');
const { cleanEnvironment } = require('./StartupEnvironment');
let inspectionStage = 'paths';
const inspectionStages = new Set(['paths', 'credentials', 'account', 'configuration', 'network', 'tls', 'recordings']);

function noSymlinks(directory) {
    const absolute = path.resolve(directory);
    let current = path.parse(absolute).root;
    for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink in instance path');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}

function writeMetadata(filename, data, mode = 0o600) {
    noSymlinks(filename);
    const temporary = `${filename}.${require('node:crypto').randomUUID()}`;
    const fd = fs.openSync(temporary, 'wx', mode);
    try {
        fs.fchmodSync(fd, mode);
        fs.writeFileSync(fd, JSON.stringify(data));
    } catch (error) {
        fs.unlinkSync(temporary);
        throw error;
    } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, filename); }
    finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

function readMetadata(filename) {
    noSymlinks(filename);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o022) || (stat.uid !== 0 && stat.uid !== process.getuid?.())) {
        throw Error('Unsafe launch metadata');
    }
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function addressOverlaps(a, b) {
    // Conservative dual-stack policy: :: may also accept IPv4 connections.
    const normalize = value => {
        if (net.isIP(value) !== 6) return value;
        const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
        const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
        if (!mapped) return canonical;
        const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
        return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    };
    a = normalize(a); b = normalize(b);
    return a === b || a === '::' || b === '::' ||
        (a === '0.0.0.0' && net.isIP(b) === 4) || (b === '0.0.0.0' && net.isIP(a) === 4);
}

function checkPlans(plans, cpuCount = require('node:os').cpus().length) {
    for (let i = 0; i < plans.length; i++) {
        const a = plans[i];
        for (const b of plans.slice(i + 1)) {
            if (a.name === b.name) continue;
            for (const x of a.listeners) for (const y of b.listeners) {
                if (x.protocol === y.protocol && addressOverlaps(x.ip, y.ip) && x.min <= y.max && y.min <= x.max) {
                    throw Error(`Instances ${a.name} and ${b.name}: overlapping ${x.protocol} ${x.kind}/${y.kind} ports ${Math.max(x.min, y.min)}..${Math.min(x.max, y.max)}`);
                }
            }
            for (const x of [a.config, a.recordings]) for (const y of [b.config, b.recordings]) {
                if (x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep)) {
                    // The default config tree intentionally contains instances/.
                    if (x === a.config && y === b.config && a.config !== b.config && (a.name === 'default' || b.name === 'default')) continue;
                    throw Error(`Instances ${a.name} and ${b.name}: overlapping configuration/state paths`);
                }
            }
        }
    }
    const workerTotals = new Map();
    for (const plan of plans) workerTotals.set(plan.name, Math.max(workerTotals.get(plan.name) || 0, plan.workers));
    const total = [...workerTotals.values()].reduce((sum, workers) => sum + workers, 0);
    return total > cpuCount ? `Configured worker total ${total} exceeds ${cpuCount} CPUs` : null;
}

async function inspect(name, configDirectory, stateDirectory, user, group) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw Error('Invalid instance');
    noSymlinks(configDirectory);
    if (stateDirectory) noSymlinks(stateDirectory);
    inspectionStage = 'credentials';
    const readSecret = filename => {
        const stat = fs.lstatSync(filename);
        if (!stat.isFile() || (stat.mode & 0o022)) throw Error('Unsafe credential file');
        return fs.readFileSync(filename, 'utf8').trim();
    };
    process.env.JWT_SECRET = fs.existsSync(path.join(configDirectory, 'jwt-secret'))
        ? readSecret(path.join(configDirectory, 'jwt-secret')) : require('node:crypto').randomBytes(32).toString('hex');
    process.env.HOST_USERS = readSecret(path.join(configDirectory, 'users'));
    inspectionStage = 'account';
    const commandOptions = { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'] };
    const uid = Number(execFileSync('/usr/bin/id', ['-u', user], commandOptions).trim());
    const gid = Number(execFileSync('/usr/bin/id', ['-g', user], commandOptions).trim());
    execFileSync('/usr/bin/getent', ['group', group], commandOptions);
    if (process.getuid?.() === 0) {
        process.initgroups(user, gid);
        process.setgid(gid);
        process.setuid(uid);
    } else if (uid !== process.getuid?.()) throw Error('Cannot validate service account');
    fs.accessSync(path.join(configDirectory, 'kaigi.conf'), fs.constants.R_OK);
    inspectionStage = 'configuration';
    const config = require('./config');
    require('./JwtSecret').getJwtKeys(config.security.jwt.key);
    require('./middleware/ResourcePolicy').buildResourcePolicy(config.server.hostUrl);
    const { seconds } = require('./ConnectionSecurity');
    for (const [name, fallback] of [['CONNECTION_INITIAL_TIMEOUT', 15], ['SOCKET_AUTH_TIMEOUT', 30],
        ['HTTP_HEADERS_TIMEOUT', 30], ['HTTP_REQUEST_TIMEOUT', 120], ['HTTP_KEEPALIVE_TIMEOUT', 5], ['HTTP_IDLE_TIMEOUT', 30]]) {
        seconds(name, fallback);
    }
    inspectionStage = 'network';
    await require('./NetworkConfig').configureFreeBSDNetwork(config);
    inspectionStage = 'tls';
    require('node:tls').createSecureContext({
        cert: fs.readFileSync(path.resolve(__dirname, config.server.ssl.cert)),
        key: fs.readFileSync(path.resolve(__dirname, config.server.ssl.key)),
    });
    const media = config.mediasoup.webRtcTransport.listenInfos;
    const listeners = [{ kind: 'web', protocol: 'tcp', ip: config.server.listen.ip,
        min: Number(config.server.listen.port), max: Number(config.server.listen.port) },
        ...media.map(info => ({ kind: 'media', protocol: info.protocol, ip: info.ip,
            min: info.portRange.min, max: info.portRange.max }))];
    for (const listener of listeners) {
        if (!net.isIP(listener.ip) || !Number.isInteger(listener.min) || !Number.isInteger(listener.max) ||
            listener.min < 1 || listener.max > 65535 || listener.max < listener.min) throw Error('Invalid listener');
    }
    inspectionStage = 'recordings';
    noSymlinks(config.media.recording.dir);
    if (config.media.recording.enabled && (!stateDirectory || fs.existsSync(stateDirectory))) {
        let parent = config.media.recording.dir;
        while (!fs.existsSync(parent)) parent = path.dirname(parent);
        fs.accessSync(parent, fs.constants.W_OK | fs.constants.X_OK);
    }
    if (stateDirectory && fs.existsSync(stateDirectory)) fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return { name, config: path.resolve(configDirectory), recordings: config.media.recording.dir,
        workers: config.mediasoup.numWorkers, listeners };
}

function signalReady() {
    if (!process.env.KAIGI_READY_FILE) return;
    fs.writeFileSync(process.env.KAIGI_READY_FILE, JSON.stringify({ pid: process.pid,
        nonce: process.env.KAIGI_STARTUP_NONCE }), { flag: 'wx', mode: 0o600 });
}

function processStamp(pid) {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8', timeout: 1000, env: { PATH: '/bin:/usr/bin', TZ: 'UTC', LC_ALL: 'C' },
    }).trim();
}

async function main(args) {
    const [mode, ...rest] = args;
    if (mode === 'wait') {
        const [filename, pidfile, nonce, seconds] = rest;
        if (!/^[1-9][0-9]*$/.test(seconds || '') || Number(seconds) > 300) throw Error('Invalid readiness deadline');
        const deadline = performance.now() + Number(seconds) * 1000;
        while (performance.now() < deadline) {
            try { await main(['ready', filename, pidfile, nonce]); return; } catch {}
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error('Readiness deadline expired');
    } else if (mode === 'inspect') {
        const [name, configDirectory, stateDirectory, user, group] = rest;
        const plan = await inspect(name, configDirectory, stateDirectory, user, group);
        process.stdout.write(JSON.stringify(plan));
    } else if (mode === 'preflight') {
        const [configRoot, stateRoot, runRoot, selected, operation, ...instances] = rest;
        if (!instances.length || instances.length % 3) throw Error('Invalid instance plan');
        const plans = [];
        for (let i = 0; i < instances.length; i += 3) {
            const [name, user, group] = instances.slice(i, i + 3);
            const config = name === 'default' ? configRoot : path.join(configRoot, 'instances', name);
            const state = name === 'default' ? '' : path.join(stateRoot, name);
            const environment = cleanEnvironment({ PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || 'production',
                KAIGI_INSTANCE: name, KAIGI_CONFIG_DIR: config, ...(state ? { KAIGI_STATE_DIR: state } : {}) });
            const result = spawnSync(process.execPath, [__filename, 'inspect', name, config, state, user, group], {
                env: environment, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576,
            });
            // Never forward dependency/configuration exception text or credentials.
            if (result.status !== 0) {
                const stage = result.stderr?.trim();
                throw Error(`Instance ${name}: ${inspectionStages.has(stage) ? stage : 'startup configuration'} validation failed`);
            }
            plans.push(JSON.parse(result.stdout));
        }
        const active = [];
        for (const entry of fs.readdirSync(runRoot, { withFileTypes: true })) {
            const name = entry.name === 'kaigi.pid' ? 'default' : entry.name;
            if (name !== 'default' && (!entry.isDirectory() || !/^[a-z][a-z0-9_]{0,31}$/.test(name))) continue;
            // Only a single selected instance is guaranteed to stop before its
            // replacement starts. Group restart remains sequential, so other
            // selected instances' old allocations must still be considered.
            const selectedNames = selected.split(',').filter(Boolean);
            if (operation === 'restart' && selectedNames.length === 1 && selectedNames[0] === name) continue;
            const directory = name === 'default' ? runRoot : path.join(runRoot, name);
            const pidfile = path.join(directory, 'kaigi.pid');
            if (!fs.existsSync(pidfile)) continue;
            noSymlinks(pidfile);
            const pid = Number(fs.readFileSync(pidfile, 'utf8').trim());
            if (!Number.isSafeInteger(pid) || pid < 2) throw Error(`Instance ${name}: invalid PID`);
            try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
            const snapshot = path.join(directory, 'launch-plan.json');
            noSymlinks(snapshot);
            if (!fs.existsSync(snapshot)) throw Error(`Instance ${name}: running allocation is unknown; stop it before upgrading startup safety`);
            const plan = readMetadata(snapshot);
            if (plan.pid !== pid || !plan.started || plan.started !== processStamp(pid)) throw Error(`Instance ${name}: stale process identity; inspect its PID file`);
            active.push(plan);
        }
        const warning = checkPlans([...plans, ...active]);
        if (warning) process.stderr.write(`kaigi: warning: ${warning}\n`);
        noSymlinks(path.join(runRoot, 'preflight.json'));
        writeMetadata(path.join(runRoot, 'preflight.json'), plans);
    } else if (mode === 'save-plan') {
        const [filename, name, destination] = rest;
        const plan = readMetadata(filename).find(item => item.name === name);
        if (!plan) throw Error('Missing validated launch plan');
        noSymlinks(destination);
        writeMetadata(destination, plan, 0o644);
    } else if (mode === 'ready') {
        const [filename, pidfile, nonce] = rest;
        const stat = fs.lstatSync(filename);
        if (!stat.isFile() || stat.size > 4096) throw Error('Invalid readiness receipt');
        const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
        const pid = Number(fs.readFileSync(pidfile, 'utf8').trim());
        if (!Number.isSafeInteger(pid) || pid < 2 || data.pid !== pid || data.nonce !== nonce) throw Error('Not ready');
        process.kill(pid, 0);
        const snapshot = path.join(path.dirname(pidfile), 'launch-plan.json');
        noSymlinks(snapshot);
        const plan = readMetadata(snapshot);
        writeMetadata(snapshot, { ...plan, pid, started: processStamp(pid) }, 0o644);
    } else if (mode === 'identity') {
        const [pidfile] = rest;
        const snapshot = path.join(path.dirname(pidfile), 'launch-plan.json');
        if (!fs.existsSync(snapshot)) return; // Explicit stop of a pre-safety installation.
        noSymlinks(snapshot);
        const plan = readMetadata(snapshot);
        const pid = Number(fs.readFileSync(pidfile, 'utf8').trim());
        if (!Number.isSafeInteger(pid) || pid < 2 || pid !== plan.pid || !plan.started || processStamp(pid) !== plan.started) throw Error('Stale process identity');
    } else throw Error('Unknown startup-safety operation');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
    // Inspect errors are deliberately opaque; the parent reports the instance.
    if (process.argv[2] === 'preflight') process.stderr.write(`kaigi: ${error.message}\n`);
    if (process.argv[2] === 'inspect') process.stderr.write(inspectionStage);
    process.exitCode = 1;
});
module.exports = { addressOverlaps, checkPlans, noSymlinks, signalReady, inspect };
