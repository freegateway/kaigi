'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sinon = require('sinon');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient.js'), 'utf8');

describe('local read-aloud microphone privacy', () => {
    let clock, client, synthesis, utterances, context, producer;
    const makeTrack = () => ({ enabled: true, readyState: 'live', getSettings: () => ({}), stop() { this.readyState = 'ended'; } });
    beforeEach(() => {
        clock = sinon.useFakeTimers();
        utterances = [];
        synthesis = { speaking: true, pending: false, speak: s => utterances.push(s), cancel() { this.speaking = false; this.pending = false; } };
        context = vm.createContext({ window: { speechSynthesis: synthesis }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
            setInterval, clearInterval, console: { log() {}, warn() {}, error() {} },
            BUTTONS: { main: { startAudioButton: true }, settings: { customNoiseSuppression: false } },
            navigator: { mediaDevices: { getSupportedConstraints: () => ({}) } },
            getMicrophoneVolumeIndicator() {}, handleMediaError: error => { throw error; },
        });
        vm.runInContext(source + ';globalThis.Client = RoomClient; globalThis.audioType = mediaType.audio;', context);
        const track = makeTrack();
        producer = { track, paused: false, pause() { this.paused = true; this.track.enabled = false; }, resume() { this.paused = false; this.track.enabled = true; } };
        client = Object.assign(Object.create(context.Client.prototype), {
            producers: new Map([['mic', producer]]), producerLabel: new Map([[context.audioType, 'mic']]),
            socket: { request: async () => ({}) }, event() {}, getId: () => null, peer_info: {}, microphoneRequest: 0,
        });
    });
    afterEach(() => { client.disposeSpeech(); clock.restore(); });

    it('silences queued private messages until the last end/error and never changes peer mute state', () => {
        client.speechMessage(false, 'Alice', 'private');
        client.speechText('second');
        assert.equal(producer.track.enabled, false);
        assert.equal(producer.paused, false);
        assert.match(utterances[0].text, /Alice.*private/);
        utterances[0].onend(); assert.equal(producer.track.enabled, false);
        utterances[1].onerror(); assert.equal(producer.track.enabled, true);
        assert.equal(clock.countTimers(), 0);
    });
    it('preserves manual mute and push-to-talk press/release during queued speech', async () => {
        client.speechText('private');
        await client.pauseProducer(context.audioType);
        await client.resumeProducer(context.audioType);
        assert.equal(producer.track.enabled, false);
        await client.pauseProducer(context.audioType);
        utterances[0].onend();
        assert.equal(producer.track.enabled, false);
        await client.resumeProducer(context.audioType);
        assert.equal(producer.track.enabled, true);
    });
    it('does not enable an already muted microphone after speech', () => {
        producer.paused = true; producer.track.enabled = false;
        client.speechText('private'); utterances[0].onend();
        assert.equal(producer.track.enabled, false);
    });
    it('guards a freshly acquired or recovered microphone before publication, including an in-flight producer', async () => {
        const track = makeTrack();
        const stream = { active: true, getAudioTracks: () => [track], getTracks: () => [track] };
        context.navigator.mediaDevices.getUserMedia = async () => stream;
        client.getAudioConstraints = () => ({});
        client.device = { canProduce: () => true };
        client.handleProducer = async () => ({});
        client.setIsAudio = () => {}; client.sound = () => {};
        let finish;
        client.producerTransport = { produce: async params => {
            assert.equal(params.track.enabled, false, 'silent before transport receives it');
            await new Promise(resolve => { finish = resolve; });
            return { id: 'new-mic', track, on() {} };
        } };
        client.speechText('private');
        client.producerLabel.delete(context.audioType);
        const publishing = client.produce(context.audioType, null, false, false, { stream, track });
        await Promise.resolve();
        assert.equal(track.enabled, false);
        utterances[0].onend();
        assert.equal(track.enabled, true, 'speech finishing restores an in-flight track');
        finish(); await publishing;
        assert.equal(client.producerLabel.get(context.audioType), 'new-mic');
        client.speechText('next'); assert.equal(track.enabled, false);
        utterances[1].onend(); assert.equal(track.enabled, true);
    });
    it('guards the native microphone before RNNoise fallback replaces the transmitted track', async () => {
        const raw = makeTrack(), processed = makeTrack();
        raw.applyConstraints = async () => {}; raw.getConstraints = () => ({});
        const stream = { getAudioTracks: () => [raw] }, processedStream = { getAudioTracks: () => [processed] };
        const processor = { processedStream, stopProcessing() {} };
        client.RNNoiseProcessor = processor; client.noiseSuppressionRequest = 1;
        client.localAudioStream = processedStream;
        producer.track = processed;
        producer.replaceTrack = async ({ track }) => { assert.equal(track.enabled, false); producer.track = track; };
        client.handleRNNoiseNotSupported = () => {}; client.syncRecordingAudio = () => {};
        context.userLog = () => {};
        client.speechText('private');
        await client.fallbackRNNoiseSuppression(stream, processor, 1);
        assert.equal(raw.enabled, false);
        utterances[0].onend(); assert.equal(raw.enabled, true);
        assert.equal(processed.readyState, 'ended');
    });
    it('recovers cancellation or missing callbacks but keeps stalled speech safely silent', () => {
        client.speechText('private'); clock.tick(3000);
        assert.equal(producer.track.enabled, false);
        synthesis.speaking = false; synthesis.pending = true; clock.tick(1000);
        assert.equal(producer.track.enabled, false);
        synthesis.cancel(); clock.tick(1000);
        assert.equal(producer.track.enabled, true);
        assert.equal(clock.countTimers(), 0);
    });
    it('recovers synchronous synthesis failure and cancels on teardown without reopening the mic', () => {
        synthesis.speak = () => { throw Error('unavailable'); };
        client.speechText('private'); assert.equal(producer.track.enabled, true);
        synthesis.speak = s => utterances.push(s);
        client.speechText('private'); client.disposeSpeech();
        assert.equal(producer.track.enabled, false);
        utterances[0].onend(); assert.equal(producer.track.enabled, false);
        client.speechText('late'); assert.equal(utterances.length, 1);
        assert.equal(clock.countTimers(), 0);
    });
});
