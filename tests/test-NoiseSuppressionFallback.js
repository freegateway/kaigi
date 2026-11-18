'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient.js'), 'utf8');
function harness() {
    const c = { console: { log() {}, warn() {} }, localStorageSettings: { mic_noise_suppression: false }, BUTTONS: { settings: { customNoiseSuppression: true } }, mediaType: { audio: 'audio' }, navigator: { mediaDevices: {} } };
    vm.runInNewContext(source + ';globalThis.Client=RoomClient;', c);
    return { c, client: Object.create(c.Client.prototype) };
}
describe('microphone noise suppression', () => {
    it('uses browser suppression when RNNoise is not selected', () => {
        const { client } = harness(); client.isRNNoiseSupported = true;
        assert.equal(client.isRNNoiseSuppressionSelected(), false);
    });
    it('serializes rapid toggles and leaves the newest native suppression state applied', async () => {
        const { client } = harness(); let native = false; const calls = [];
        const track = { readyState: 'live', getSettings: () => ({ noiseSuppression: native }), getConstraints: () => ({}), applyConstraints: async value => { calls.push(value.noiseSuppression); native = value.noiseSuppression; } };
        const processor = { noiseSuppressionEnabled: false, isProcessing: true, mediaStream: { getAudioTracks: () => [track] } };
        client.RNNoiseProcessor = processor;
        const first = client.syncNativeNoiseSuppression();
        processor.noiseSuppressionEnabled = true; const second = client.syncNativeNoiseSuppression();
        await Promise.all([first, second]);assert.equal(native, false);
        processor.noiseSuppressionEnabled = false;await client.syncNativeNoiseSuppression();assert.equal(native, true);assert.deepEqual(calls, [true]);
    });
    it('reports recapture failure and closes the ended producer instead of silently leaving it active', async () => {
        const { client, c } = harness(); let stopped = false, closed = false, synced = false;
        c.navigator.mediaDevices.getUserMedia = async () => { throw Error('unavailable'); };
        client.getAudioConstraints = () => ({ audio: {} });client.disableRNNoiseSuppression = () => {};
        client.closeProducer = () => { closed = true; };client.syncRecordingAudio = () => { synced = true; };
        const track = { getSettings: () => ({ deviceId: 'mic' }), stop: () => { stopped = true; } };
        await assert.rejects(client.recaptureNoiseSuppressionInput({}, track, true, () => true), /Microphone input was lost/);
        assert(stopped && closed && synced);
    });
    it('preserves a muted input when replacing the microphone feeding RNNoise', () => {
        const context = { console: { log() {}, warn() {} } };
        vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/NodeProcessor.js'), 'utf8') + ';globalThis.Processor=RNNoiseProcessor;', context);
        const processor = Object.create(context.Processor.prototype);
        let disconnected = false, stopped = false;
        processor.mediaStream = { getAudioTracks: () => [{ enabled: false }], getTracks: () => [{ stop() { stopped = true; } }] };
        processor.isProcessing = true; processor.workletNode = {};
        processor.sourceNode = { disconnect() { disconnected = true; } };
        processor.audioContext = { createMediaStreamSource: () => ({ connect() {} }) };
        const track = { enabled: true };
        assert.equal(processor.replaceInput({ getAudioTracks: () => [track] }), true);
        assert.equal(track.enabled, false); assert(disconnected && stopped);
    });

});
