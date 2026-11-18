'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient.js'), 'utf8');
describe('file-scoped browser recording start', () => {
    function fixture() {
        const context = { console: { log() {}, warn() {} } };
        vm.runInNewContext(source + ';globalThis.Client=RoomClient;', context);
        const client = Object.create(context.Client.prototype);
        let resolve, reject, starts = 0, stopped = 0;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        Object.assign(client, { mediaRecorder: {}, recording: { recSyncServerRecording: true }, socket: { connected: true, request: () => promise },
            beginRecording() { starts++; }, releaseRecordingAudioMixer() {}, handleRecordingError() {},
            recScreenStream: { getVideoTracks: () => [{ stop() { stopped++; } }] }, recScreenAudioTracks: [{ stop() { stopped++; } }], screenAudioRecorder: { stopMixedAudioStream() { stopped++; } } });
        return { client, resolve, reject, starts: () => starts, stopped: () => stopped };
    }
    it('does not start capture until the server issues the exact file capability', async () => {
        const h = fixture(), pending = h.client.initRecording();
        assert.equal(h.starts(), 0);
        h.resolve({ fileName: 'Rec_opaque.webm', token: 'capability' }); await pending;
        assert.equal(h.starts(), 1);assert.equal(h.client.recServerFileName, 'Rec_opaque.webm');assert.equal(h.client.recUploadToken, 'capability');
    });
    it('releases recording-only capture when issuance fails or is cancelled before acknowledgement', async () => {
        for (const cancelled of [false, true]) {
            const h = fixture(), pending = h.client.initRecording();
            if (cancelled) h.client._recordingStartGeneration++;
            if (cancelled) h.resolve({ fileName: 'Rec_opaque.webm', token: 'capability' }); else h.reject(Error('denied'));
            await pending;assert.equal(h.starts(), 0);assert.equal(h.stopped(), 3);assert.equal(h.client.mediaRecorder, null);
        }
    });
});
