'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const proxyquire = require('proxyquire');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const clientSource = read('public/js/RoomClient.js');

describe('mobile camera profiles', () => {
    function client(mobile, quality = 'default', fps = 'max') {
        const context = vm.createContext({
            console: { log() {} },
            videoQuality: { value: quality },
            videoFps: { value: fps },
        });
        vm.runInContext(clientSource + ';globalThis.proto = RoomClient.prototype;', context);
        const instance = Object.create(context.proto);
        // Execute the production constructor's profile assignments without opening devices.
        context.instance = instance;
        const assignments = clientSource.match(
            /this\.(?:mobile\w+|numSimulcastStreamsWebcam\w*|webcamScalabilityMode) = [^;]+;/g
        );
        assert.ok(assignments?.length >= 2);
        vm.runInContext('(function(){' + assignments.join('\n') + '}).call(instance)', context);
        instance.isMobileDevice = mobile;
        instance.getSelectedIndexValue = (select) => select.value;
        return instance;
    }

    it('uses VGA/20fps only for mobile defaults, retaining desktop HD/30fps', () => {
        for (const mobile of [false, true]) {
            const constraints = client(mobile).getVideoConstraints('camera').video;
            assert.deepEqual(plain(constraints), {
                width: { ideal: mobile ? 640 : 1280 },
                height: { ideal: mobile ? 480 : 720 },
                frameRate: { ideal: mobile ? 20 : 30 },
                deviceId: { exact: 'camera' },
            });
        }
    });

    it('honours explicitly selected quality and FPS on mobile and desktop', () => {
        for (const mobile of [false, true]) {
            const constraints = client(mobile, 'fhd', '60').getVideoConstraints().video;
            assert.deepEqual(plain(constraints), {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 60 },
            });
            assert.equal(client(mobile, 'vga', '15').getVideoConstraints().video.frameRate.ideal, 15);
        }
    });

    for (const mimeType of ['video/VP8', 'video/H264', 'video/VP9', 'video/AV1']) {
        it(`uses bounded mobile layers and unchanged desktop layers for ${mimeType}`, () => {
            for (const quality of ['default', 'hd', 'fhd']) {
                for (const mobile of [false, true]) {
                    const instance = client(mobile, quality);
                    instance.enableWebcamLayers = true;
                    instance.device = { rtpCapabilities: { codecs: [{ kind: 'video', mimeType }] } };
                    const { encodings } = instance.getWebCamEncoding();
                    const svc = ['video/VP9', 'video/AV1'].includes(mimeType);
                    assert.equal(encodings.length, svc ? 1 : mobile ? 2 : 3);
                    assert.equal(
                        encodings.at(-1).maxBitrate,
                        mobile ? (quality === 'default' ? 700000 : 1500000) : 5000000
                    );
                    if (!svc) {
                        assert.deepEqual(
                            Array.from(encodings, (entry) => entry.maxBitrate),
                            mobile ? [150000, quality === 'default' ? 700000 : 1500000] : [500000, 1000000, 5000000]
                        );
                    }
                    instance.enableWebcamLayers = false;
                    assert.equal(instance.getWebCamEncoding().encodings, undefined);
                }
            }
        });
    }

    it('retains administrator-disabled desktop simulcast layers', () => {
        const instance = client(false);
        instance.enableWebcamLayers = true;
        instance.numSimulcastStreamsWebcam = 1;
        instance.device = { rtpCapabilities: { codecs: [{ kind: 'video', mimeType: 'video/VP8' }] } };
        assert.equal(instance.getWebCamEncoding().encodings.length, 1);
    });
});

describe('shipped Firefox client ICE configuration', () => {
    it('updates ICE servers without losing other settings and rejects updates after close', async () => {
        let pc;
        const context = vm.createContext({
            console,
            setTimeout,
            clearTimeout,
            MediaStream: class {},
            RTCPeerConnection: class {
                constructor(configuration) {
                    this.configuration = configuration;
                    pc = this;
                }
                addEventListener() {}
                removeEventListener() {}
                getConfiguration() {
                    return { ...this.configuration };
                }
                setConfiguration(configuration) {
                    this.configuration = configuration;
                }
                close() {}
            },
        });
        vm.runInContext(read('public/sfu/MediasoupClient.js'), context);
        const device = new context.mediasoupClient.Device({ handlerName: 'Firefox120' });
        const handler = device._handlerFactory.factory({ direction: 'send' });
        const servers = [{ urls: 'turn:relay.example.test', username: 'test', credential: 'test' }];
        await handler.updateIceServers(servers);
        assert.equal(context.mediasoupClient.version, '3.26.0');
        assert.deepEqual(plain(pc.configuration.iceServers), servers);
        assert.equal(pc.configuration.bundlePolicy, 'max-bundle');
        assert.equal(pc.configuration.iceTransportPolicy, 'all');
        await handler.updateIceServers([]);
        assert.deepEqual(plain(pc.configuration.iceServers), []);
        handler.close();
        await assert.rejects(handler.updateIceServers(servers), { name: 'InvalidStateError' });
    });
});

describe('transport shutdown failures', () => {
    function logger() {
        const entries = [];
        return {
            entries,
            debug: (...args) => entries.push(['debug', ...args]),
            error: (...args) => entries.push(['error', ...args]),
        };
    }
    for (const closedRouter of [false, true]) {
        it(`reports worker unavailability without error-level logs (${closedRouter ? 'closed router' : 'WorkerClosedError'})`, async () => {
            const log = logger();
            const Room = proxyquire('../app/src/Room', {
                './Logger': class {
                    constructor() {
                        return log;
                    }
                },
            });
            const room = Object.create(Room.prototype);
            room.peers = new Map([['peer', {}]]);
            room.webRtcTransport = {};
            room.router = {
                closed: closedRouter,
                createWebRtcTransport: async () => {
                    const error = new Error('worker pipe closed');
                    if (!closedRouter) error.name = 'WorkerClosedError';
                    throw error;
                },
            };
            await assert.rejects(room.createWebRtcTransport('peer'), {
                name: 'WorkerClosedError',
                message: 'Media server unavailable',
            });
            assert.equal(
                log.entries.some(([level]) => level === 'error'),
                false
            );
        });
    }

    it('retains error-level diagnostics for an unrelated allocation failure', async () => {
        const log = logger();
        const Room = proxyquire('../app/src/Room', {
            './Logger': class {
                constructor() {
                    return log;
                }
            },
        });
        const room = Object.create(Room.prototype);
        room.peers = new Map([['peer', {}]]);
        room.webRtcTransport = {};
        room.router = {
            closed: false,
            createWebRtcTransport: async () => {
                throw new Error('allocation failed');
            },
        };
        await assert.rejects(room.createWebRtcTransport('peer'), { message: 'Error creating WebRTC Transport' });
        assert.equal(
            log.entries.some(([level]) => level === 'error'),
            true
        );
    });

    async function request({ shuttingDown = false, failure, shutdownDuringAllocation = false } = {}) {
        const source = read('app/src/Server.js');
        const start = source.indexOf("        socket.on('createWebRtcTransport'");
        const end = source.indexOf("        socket.on('connectTransport'", start);
        assert.ok(start > 0 && end > start);
        let handler,
            reply,
            allocations = 0;
        const warnings = [];
        const context = vm.createContext({
            socket: {
                id: 'peer',
                on: (_event, callback) => {
                    handler = callback;
                },
            },
            isShuttingDown: shuttingDown,
            roomExists: () => true,
            isPeerInLobby: () => false,
            getPeerInfo: () => ({}),
            getRoomAndPeer: () => ({
                peer: {},
                room: {
                    createWebRtcTransport: async () => {
                        allocations++;
                        if (shutdownDuringAllocation) context.isShuttingDown = true;
                        if (failure) throw failure;
                        return { id: 'transport' };
                    },
                },
            }),
            log: { debug() {}, warn: (...args) => warnings.push(args) },
        });
        vm.runInContext(source.slice(start, end), context);
        await handler({}, (result) => {
            reply = plain(result);
        });
        return { reply, allocations, warnings };
    }

    it('rejects new allocations during shutdown', async () => {
        const result = await request({ shuttingDown: true });
        assert.deepEqual(result.reply, { error: 'Server is shutting down' });
        assert.equal(result.allocations, 0);
    });

    it('acknowledges worker closure and shutdown races without warnings', async () => {
        for (const shutdownDuringAllocation of [false, true]) {
            const failure = new Error('Media server unavailable');
            if (!shutdownDuringAllocation) failure.name = 'WorkerClosedError';
            const result = await request({ failure, shutdownDuringAllocation });
            assert.deepEqual(result.reply, { error: 'Media server unavailable' });
            assert.equal(result.warnings.length, 0);
        }
    });

    it('preserves successful allocation and unexpected failure diagnostics', async () => {
        assert.deepEqual((await request()).reply, { id: 'transport' });
        const result = await request({ failure: new Error('allocation failed') });
        assert.deepEqual(result.reply, { error: 'allocation failed' });
        assert.equal(result.warnings.length, 1);
    });
});
