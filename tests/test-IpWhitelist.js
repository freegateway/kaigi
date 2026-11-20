'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const express = require('express');
const proxyquire = require('proxyquire');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const web = require('../app/src/WebDeployment');
const source = fs.readFileSync(require.resolve('../app/src/Server'), 'utf8');
function policy(allowedIPs, enabled = true) {
	return proxyquire('../app/src/middleware/IpWhitelist', {
		'../config': { security: { middleware: { IpWhitelist: { enabled, allowedIPs } } } },
	});
}
describe('IP allow-list across HTTP and Engine.IO', function () {
	this.timeout(5000);
	it('does not trust spoofed forwarded addresses or admit unknown peers', () => {
		const middleware = policy(['192.0.2.10', 'unknown']);
		for (const req of [{ headers: { 'x-forwarded-for': '192.0.2.10' }, socket: { remoteAddress: '198.51.100.1' } }, {}]) {
			middleware.allowSocketRequest(req, (err, allowed) => { assert.equal(err, null); assert.equal(allowed, false); });
		}
		policy(['127.0.0.1']).allowSocketRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }, (_, allowed) => assert(allowed));
		policy([], false).allowSocketRequest({}, (_, allowed) => assert(allowed));
	});
	for (const mode of ['direct', 'proxy-tcp', 'proxy-unix']) it(`enforces assets, API and Socket.IO in ${mode}`, async function () {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-allow-'));
		const socketPath = path.join(directory, 'web.socket');
		const unix = mode === 'proxy-unix';
		const proxied = mode !== 'direct';
		const deployment = web.settings(proxied ? {
			WEB_MODE: 'proxy', WEB_URL: 'https://meet.example',
			...(unix ? { WEB_LISTEN_SOCKET: socketPath } : { WEB_LISTEN_IP: '127.0.0.1', WEB_PROXY_IPS: '127.0.0.1' }),
		} : {});
		const restrictAccessByIP = policy([proxied ? '192.0.2.10' : '192.0.2.99']);
		const app = express();
		// Execute the production registration, including its exact middleware position.
		const registration = source.slice(source.indexOf('function startServer() {'), source.indexOf("    app.use(require('./middleware/ResourcePolicy')"));
		vm.runInNewContext(`${registration}\n} startServer();`, { app, trustProxy: false, restrictAccessByIP });
		fs.writeFileSync(path.join(directory, 'fixture.css'), 'body{}');
		app.use(express.static(directory));
		app.get('/api/fixture', (req, res) => res.json({ ok: true }));
		const server = http.createServer((req, res) => {
			if (!web.acceptRequest(req, deployment)) { res.writeHead(403); return res.end(); }
			app(req, res);
		});
		const io = new Server(server, { transports: ['websocket'] });
		const hook = source.slice(source.indexOf('io.engine.use('), source.indexOf("const { securityEvent, peerAddress }"));
		vm.runInNewContext(hook, { io, webListener: web, webDeployment: deployment, restrictAccessByIP });
		const clients = [];
		try {
			try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(unix ? socketPath : { host: '127.0.0.1', port: 0 }, resolve); }); }
			catch (error) { if (unix && error.code === 'EPERM') { this.skip(); return; } throw error; }
			const endpoint = unix ? { socketPath } : { host: '127.0.0.1', port: server.address().port };
			const headers = { host: 'meet.example', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.10' };
			const request = (pathname, extra = {}) => new Promise((resolve, reject) => http.get({ ...endpoint, path: pathname, headers: { ...headers, ...extra } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));
			for (const pathname of ['/fixture.css', '/api/fixture']) {
				assert.equal(await request(pathname), proxied ? 200 : 403);
				assert.equal(await request(pathname, { 'x-forwarded-for': '198.51.100.1' }), 403);
			}
			async function handshake(address, expected) {
				const client = new WebSocket('ws://meet.example/socket.io/?EIO=4&transport=websocket', {
					createConnection: () => unix ? net.connect(socketPath) : net.connect(endpoint.port, endpoint.host),
					headers: { ...headers, 'x-forwarded-for': address },
				});
				clients.push(client);
				await new Promise((resolve, reject) => {
					client.on('message', raw => { try { assert(expected); assert(String(raw).startsWith('0')); resolve(); } catch (err) { reject(err); } });
					client.on('unexpected-response', (_, res) => { res.resume(); try { assert.equal(expected, false); assert.equal(res.statusCode, 400); resolve(); } catch (err) { reject(err); } });
					client.on('error', reject);
				});
			}
			await handshake('192.0.2.10', proxied);
			await handshake('198.51.100.1', false);
		} finally {
			clients.forEach(client => client.terminate());
			await new Promise(resolve => io.close(resolve));
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
