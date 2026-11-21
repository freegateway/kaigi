'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
describe('settings camera preview', () => {
	function fixture() {
		const dom = new JSDOM(fs.readFileSync(require.resolve('../public/views/Room.html'), 'utf8'));
		const document = dom.window.document;
		const context = vm.createContext({ window: dom.window, console, mediaType: { video: 'video' } });
		vm.runInContext(`${source}; globalThis.proto = RoomClient.prototype;`, context);
		const client = Object.assign(Object.create(context.proto), { getId: id => document.getElementById(id), isMySettingsOpen: true });
		const camera = document.createElement('video'); document.body.append(camera);
		let stopped = 0;
		const track = { readyState: 'live', enabled: true, stop() { stopped++; } };
		const stream = { getVideoTracks: () => [track] }; camera.srcObject = stream;
		client.localVideoElement = camera;
		const video = document.getElementById('settingsVideoPreviewVideo');
		video.play = () => Promise.resolve(); video.pause = () => {};
		return { client, document, camera, track, stream, video, stopped: () => stopped };
	}
	it('reuses the processed camera and mirror state, with muted inline playback', () => {
		const f = fixture(); f.camera.classList.add('mirror'); f.client.syncSettingsVideoPreview();
		assert.equal(f.video.srcObject, f.stream); assert(f.video.muted); assert(f.video.hasAttribute('playsinline'));
		assert(f.video.classList.contains('mirror')); assert.equal(f.document.getElementById('settingsVideoPreview').hidden, false);
	});
	it('detaches on closing, disabled/ended tracks and a removed camera without stopping shared tracks', () => {
		for (const mutate of [f => f.client.isMySettingsOpen = false, f => f.track.enabled = false, f => f.track.readyState = 'ended', f => f.camera.remove()]) {
			const f = fixture(); f.client.syncSettingsVideoPreview(); mutate(f); f.client.syncSettingsVideoPreview();
			assert.equal(f.video.srcObject, null); assert.equal(f.document.getElementById('settingsVideoPreview').hidden, !f.client.isMySettingsOpen); assert.equal(f.stopped(), 0);
		}
	});
	it('moves one preview between video/background tabs and follows replacement streams', () => {
		const f = fixture(); f.client.moveSettingsVideoPreview('tabVirtualBackground');
		assert.equal(f.video.closest('.tabcontent').id, 'tabVirtualBackground');
		f.client.moveSettingsVideoPreview('tabVideoDevices'); assert.equal(f.video.closest('.tabcontent').id, 'tabVideoDevices');
		const replacement = { getVideoTracks: () => [f.track] }; f.camera.srcObject = replacement; f.client.syncSettingsVideoPreview();
		assert.equal(f.video.srcObject, replacement); assert.equal(f.document.querySelectorAll('#settingsVideoPreview').length, 1);
	});
	it('shows a local avatar while off and only starts the camera on a deliberate click', () => {
		const f = fixture(); f.client.localVideoElement = null;
		f.client.peer_name = 'Example'; f.client.genAvatarSvg = () => 'data:image/svg+xml,local';
		let clicks = 0;
		const start = f.document.getElementById('startVideoButton'); start.classList.remove('hidden'); start.onclick = () => clicks++;
		f.client.syncSettingsVideoPreview();
		const off = f.document.getElementById('settingsVideoPreviewOff');
		assert.equal(off.hidden, false); assert.equal(clicks, 0);
		off.click(); assert.equal(clicks, 1);
		start.disabled = true; off.click(); assert.equal(clicks, 1);
		assert(f.document.getElementById('settingsVideoPreviewAvatar').src.startsWith('data:'));
	});
});
