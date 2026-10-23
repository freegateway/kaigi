'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const nodemailer = require('nodemailer');
const proxyquire = require('proxyquire');
const Peer = require('../app/src/Peer');

describe('updated media and mail dependencies', () => {
    const mid = 'urn:ietf:params:rtp-hdrext:sdes:mid';

    for (const order of [
        ['audio', 'video'],
        ['video', 'audio'],
    ]) {
        it(`keeps audio and video MID in the shipped bundle (${order.join(' first, ')})`, async () => {
            const sdp = [
                'v=0',
                'o=- 1 1 IN IP4 127.0.0.1',
                's=-',
                't=0 0',
                ...order.flatMap((kind) => [
                    `m=${kind} 9 UDP/TLS/RTP/SAVPF ${kind === 'audio' ? 111 : 96}`,
                    'c=IN IP4 0.0.0.0',
                    `a=mid:${kind}`,
                    'a=sendrecv',
                    `a=rtpmap:${kind === 'audio' ? '111 opus/48000/2' : '96 VP8/90000'}`,
                    `a=extmap:1 ${mid}`,
                ]),
                '',
            ].join('\r\n');
            const context = vm.createContext({
                console,
                setTimeout,
                clearTimeout,
                structuredClone,
                RTCPeerConnection: class {
                    addTransceiver() {
                        return {};
                    }
                    async createOffer() {
                        return { sdp };
                    }
                    close() {}
                },
            });
            vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sfu/MediasoupClient.js'), 'utf8'), context);
            const device = new context.mediasoupClient.Device({ handlerName: 'Chrome111' });
            await device.load({
                routerRtpCapabilities: {
                    codecs: [
                        {
                            kind: 'audio',
                            mimeType: 'audio/opus',
                            preferredPayloadType: 111,
                            clockRate: 48000,
                            channels: 2,
                        },
                        { kind: 'video', mimeType: 'video/VP8', preferredPayloadType: 96, clockRate: 90000 },
                    ],
                    headerExtensions: ['audio', 'video'].map((kind) => ({ kind, uri: mid, preferredId: 1 })),
                },
            });
            for (const capabilities of [device.recvRtpCapabilities, device.sendRtpCapabilities]) {
                assert.deepEqual(Array.from(capabilities.headerExtensions, (ext) => `${ext.kind}:${ext.uri}`).sort(), [
                    `audio:${mid}`,
                    `video:${mid}`,
                ]);
            }
            assert.equal(device.canProduce('audio'), true);
            assert.equal(device.canProduce('video'), true);
        });
    }

    it('omits browser dtx for every screen encoding mode', () => {
        const context = vm.createContext({ console: { log() {} } });
        vm.runInContext(
            fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8') +
                ';globalThis.encoding = RoomClient.prototype.getScreenEncoding;',
            context
        );
        for (const mimeType of ['video/VP8', 'video/H264', 'video/VP9', 'video/AV1']) {
            for (const enabled of [true, false]) {
                const result = context.encoding.call({
                    device: { rtpCapabilities: { codecs: [{ kind: 'video', mimeType }] } },
                    enableSharingLayers: enabled,
                    numSimulcastStreamsSharing: 3,
                });
                assert.equal(
                    result.encodings.length,
                    enabled && ['video/VP8', 'video/H264'].includes(mimeType) ? 3 : 1
                );
                for (const encoding of result.encodings) {
                    assert.equal(Object.hasOwn(encoding, 'dtx'), false);
                    assert.ok(encoding.maxBitrate > 0);
                }
            }
        }
    });

    for (const type of ['screenType', 'videoType', 'audioType']) {
        it(`preserves worker screen inactivity handling for ${type}`, async () => {
            const peer = new Peer('peer', { peer_info: { peer_name: 'Attendee' } });
            const input = { encodings: [{ ssrc: 1 }, { ssrc: 2 }] };
            let received;
            peer.transports.set('transport', {
                produce: async (options) => {
                    received = options.rtpParameters;
                    return { id: 'producer', type: 'simple', appData: {}, rtpParameters: received, once() {} };
                },
            });
            await peer.createProducer('transport', input, type === 'audioType' ? 'audio' : 'video', type);
            assert.equal(Object.hasOwn(input.encodings[0], 'dtx'), false);
            assert.equal(received.encodings.length, 2);
            for (const encoding of received.encodings)
                assert.equal(encoding.dtx, type === 'screenType' ? true : undefined);
        });
    }

    it('builds Unicode mail and an ICS attachment with exact envelope recipients', async () => {
        const mailer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
        const result = await mailer.sendMail({
            from: 'Kaigi <sender@example.test>',
            to: ['one@example.test', 'two@example.test'],
            subject: '会議 — réunion',
            html: '<p>会議</p>',
            icalEvent: { method: 'REQUEST', content: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n' },
        });
        assert.deepEqual(result.envelope.to, ['one@example.test', 'two@example.test']);
        const message = result.message.toString();
        assert.match(message, /Content-Type: text\/calendar;.*method=REQUEST/i);
        assert.match(message, /BEGIN:VCALENDAR/);
        assert.match(message, /Subject: =\?UTF-8\?/i);
        assert.doesNotMatch(message, /Bcc:/);
    });

    it('reports a permanent SMTP recipient refusal', async () => {
        const sockets = new Set();
        const server = net.createServer((socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.write('220 localhost ESMTP\r\n');
            let pending = '';
            socket.on('data', (chunk) => {
                pending += chunk.toString();
                let end;
                while ((end = pending.indexOf('\r\n')) !== -1) {
                    const line = pending.slice(0, end);
                    pending = pending.slice(end + 2);
                    if (/^EHLO/.test(line)) socket.write('250 localhost\r\n');
                    else if (/^MAIL FROM/.test(line)) socket.write('250 OK\r\n');
                    else if (/^RCPT TO/.test(line)) socket.write('550 No such recipient\r\n');
                    else if (/^QUIT/.test(line)) socket.end('221 Bye\r\n');
                }
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const mailer = nodemailer.createTransport({
            host: '127.0.0.1',
            port: server.address().port,
            secure: false,
            connectionTimeout: 1000,
            greetingTimeout: 1000,
            socketTimeout: 1000,
        });
        try {
            await assert.rejects(
                mailer.sendMail({ from: 'sender@example.test', to: 'missing@example.test', text: 'test' }),
                (error) => error.responseCode === 550 && error.code === 'EENVELOPE' && error.permanent === true
            );
        } finally {
            mailer.close();
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('does not include the SMTP password in configuration logs', () => {
        const messages = [];
        proxyquire('../app/src/lib/nodemailer', {
            '../config': {
                ui: { brand: { app: { name: 'Kaigi' } } },
                integrations: {
                    email: {
                        alert: true,
                        host: 'localhost',
                        port: 465,
                        username: 'smtp-user',
                        password: 'secret-test-password',
                        sendTo: 'admin@example.test',
                    },
                },
            },
            '../Logger': class {
                info(...args) {
                    messages.push(args);
                }
            },
        });
        assert.ok(messages.length > 0);
        assert.doesNotMatch(JSON.stringify(messages), /secret-test-password|"password"/);
    });

    for (const arrayHeaders of [false, true]) {
        it(`strips credentials on cross-origin redirects with ${arrayHeaders ? 'array' : 'object'} headers`, async () => {
            const target = http.createServer((req, res) => res.end(JSON.stringify(req.headers)));
            const origin = http.createServer((req, res) => {
                res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` });
                res.end();
            });
            await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
            await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
            try {
                const fields = {
                    Authorization: 'test-secret',
                    Cookie: 'session=test',
                    'X-Api^Key': 'test-key',
                    'X-Token|Secret': 'test-token',
                };
                const headers = await new Promise((resolve, reject) => {
                    const request = require('follow-redirects').http.get(
                        {
                            hostname: '127.0.0.1',
                            port: origin.address().port,
                            path: '/',
                            headers: arrayHeaders ? Object.entries(fields).flat() : fields,
                            sensitiveHeaders: ['X-Api^Key', 'X-Token|Secret'],
                        },
                        (response) => {
                            let body = '';
                            response.on('data', (chunk) => {
                                body += chunk;
                            });
                            response.on('end', () => resolve(JSON.parse(body)));
                            response.on('error', reject);
                        }
                    );
                    request.setTimeout(1000, () => request.destroy(new Error('Redirect timed out')));
                    request.on('error', reject);
                });
                for (const name of Object.keys(fields)) assert.equal(headers[name.toLowerCase()], undefined);
            } finally {
                await Promise.all([origin, target].map((server) => new Promise((resolve) => server.close(resolve))));
            }
        });
    }

    it('rejects a long malformed IPv6 zone within a bounded subprocess', function () {
        this.timeout(5000);
        execFileSync(
            process.execPath,
            [
                '-e',
                "const assert = require('node:assert/strict'); const {Address6} = require('ip-address'); " +
                    "assert.equal(Address6.isValid('%'.repeat(1024 * 1024) + '\\n'), false); " +
                    "assert.equal(new Address6('fe80::1%em0').zone, '%em0');",
            ],
            { cwd: path.join(__dirname, '..'), timeout: 2000, stdio: 'pipe' }
        );
    });
});
