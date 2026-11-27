'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

class FakeMediaStream {
    constructor(tracks = []) {
        this.tracks = [...tracks];
    }
    addTrack(track) {
        this.tracks.push(track);
    }
    getTracks() {
        return this.tracks;
    }
    getAudioTracks() {
        return this.tracks.filter((t) => t.kind === 'audio');
    }
    getVideoTracks() {
        return this.tracks.filter((t) => t.kind === 'video');
    }
}

const audioTrack = () => ({ kind: 'audio', readyState: 'live', enabled: true, stop() {} });

describe('screen share audio volume', () => {
    let dom;
    let document;
    let RoomClientProto;

    beforeEach(() => {
        dom = new JSDOM(
            '<!doctype html><html><body><div id="remoteAudio"></div><div id="localAudio"></div></body></html>'
        );
        document = dom.window.document;
        const toggleHidden = (hidden) => (elem) => elem.classList.toggle('hidden', hidden);
        const context = vm.createContext({
            window: dom.window,
            document,
            Event: dom.window.Event,
            MediaStream: FakeMediaStream,
            setTimeout,
            clearTimeout,
            sinkId: false,
            speakerSelect: { value: '' },
            show: toggleHidden(false),
            hide: toggleHidden(true),
            console: { log() {}, info() {}, warn() {}, error() {} },
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        RoomClientProto = context.RoomClientForTest.prototype;
    });

    afterEach(() => dom.window.close());

    function createClient() {
        const client = Object.create(RoomClientProto);
        client.remoteAudioEl = document.getElementById('remoteAudio');
        client.localAudioEl = document.getElementById('localAudio');
        client.audioConsumers = new Map();
        client.consumers = new Map();
        client.consumersProducer = new Map();
        client.resumedConsumers = new Set();
        client.blockedAudioElements = new Set();
        client.producers = new Map();
        client.producerLabel = new Map();
        client.masterOutputVolume = 1;
        client.isMobileDevice = false;
        client.peer_id = 'me';
        client.peer_info = { peer_audio: true, peer_audio_volume: 100 };
        client.playRemoteAudio = () => {};
        client.sound = () => {};
        client.emitCmd = () => {};
        return client;
    }

    function addRange(id) {
        const input = document.createElement('input');
        input.id = id;
        input.type = 'range';
        input.min = 0;
        input.max = 100;
        input.value = 100;
        document.body.appendChild(input);
        return input;
    }

    const peerInfo = { peer_id: 'bob', peer_audio: true, peer_audio_volume: 100 };

    async function consumeAudio(client, id, type) {
        await client.handleConsumer(id, type, new FakeMediaStream([audioTrack()]), 'Bob', peerInfo);
        client.consumers.set(id, { kind: 'audio', close() {} });
    }

    it('gives shared screen audio its own volume slider, independent from the microphone', async () => {
        const client = createClient();
        const micRange = addRange('bob___pVolume');
        const screenRange = addRange('bob___sVolume');
        screenRange._dropdownItem = document.body.appendChild(document.createElement('div'));
        screenRange._barItem = document.body.appendChild(document.createElement('span'));

        client.handleScreenAudioVolume(screenRange);
        assert.ok(screenRange.classList.contains('hidden'), 'hidden until the screen audio arrives');
        assert.ok(screenRange._dropdownItem.classList.contains('hidden'));
        assert.ok(screenRange._barItem.classList.contains('hidden'));

        await consumeAudio(client, 'mic1', 'audioType');
        await consumeAudio(client, 'tab1', 'audioTab');

        assert.equal(client.audioConsumers.get('bob___pVolume'), 'mic1');
        assert.equal(client.audioConsumers.get('bob___sVolume'), 'tab1');
        assert.equal(screenRange.classList.contains('hidden'), false);
        assert.equal(screenRange._dropdownItem.classList.contains('hidden'), false);
        assert.equal(screenRange._barItem.classList.contains('hidden'), false);

        screenRange.value = 30;
        screenRange.dispatchEvent(new dom.window.Event('input'));
        assert.equal(document.getElementById('tab1').volume, 0.3);
        assert.equal(document.getElementById('mic1').volume, 1);

        micRange.value = 80;
        micRange.dispatchEvent(new dom.window.Event('input'));
        assert.equal(document.getElementById('mic1').volume, 0.8);
        assert.equal(document.getElementById('tab1').volume, 0.3);

        client.removeConsumer('tab1', 'audio');
        assert.ok(screenRange.classList.contains('hidden'));
        assert.ok(screenRange._dropdownItem.classList.contains('hidden'));
        assert.ok(screenRange._barItem.classList.contains('hidden'));
        assert.equal(client.audioConsumers.get('bob___pVolume'), 'mic1', 'mic volume control survives');
        assert.notEqual(micRange.style.display, 'none');
    });

    it('applies the chosen level when the screen audio arrives after the slider was moved', async () => {
        const client = createClient();
        const screenRange = addRange('bob___sVolume');
        client.handleScreenAudioVolume(screenRange);
        screenRange.value = 40;

        await consumeAudio(client, 'tab1', 'audioTab');

        assert.equal(document.getElementById('tab1').volume, 0.4);
    });

    it('publishes screen audio as audioTab without taking over the local microphone slot', async () => {
        const client = createClient();
        const myMic = document.createElement('audio');
        client.myAudioEl = myMic;
        client.audioConsumers.set('me___pVolume', 'micProducer');

        let produced;
        client.producerTransport = {
            produce: async (params) => {
                produced = params;
                return { id: 'tabProducer', on() {} };
            },
        };

        await client.produceScreenAudio(new FakeMediaStream([audioTrack()]));

        assert.equal(produced.appData.mediaType, 'audioTab');
        assert.equal(client.producerLabel.get('audioTab'), 'tabProducer');
        assert.equal(client.myAudioEl, myMic);
        assert.equal(client.audioConsumers.get('me___pVolume'), 'micProducer');
        const local = document.getElementById('tabProducer');
        assert.ok(local && local.muted, 'local monitor stays muted');
    });

    it('applies master output before a tile exists and handles either consumer arrival order and re-share', async () => {
        for (const screenFirst of [true, false]) {
            const client = createClient();
            client.setMasterOutputVolume(0.25);
            const order = screenFirst ? [['tab1', 'audioTab'], ['mic1', 'audioType']] :
                [['mic1', 'audioType'], ['tab1', 'audioTab']];
            for (const [id, type] of order) await consumeAudio(client, id, type);
            assert.equal(document.getElementById('tab1').volume, 0.25, 'master applies without a tile');
            const range = addRange('bob___sVolume');
            range.value = 40;
            client.handleScreenAudioVolume(range);
            assert.equal(document.getElementById('tab1').volume, 0.1);
            client.removeConsumer('tab1', 'audio');
            assert.ok(range.classList.contains('hidden'));
            await consumeAudio(client, 'tab2', 'audioTab');
            assert.equal(document.getElementById('tab2').volume, 0.1);
            assert.equal(document.getElementById('mic1').volume, 1, 'screen control never changes the mic');
            assert.equal(range.classList.contains('hidden'), false);
            client.removeConsumer('tab2', 'audio');
            client.removeConsumer('mic1', 'audio');
            range.remove();
        }
    });

    it('routes the compact/mobile slider locally through Web Audio without changing media tracks or broadcasting', async () => {
        const client = createClient();
        client.isMobileDevice = true;
        const range = addRange('bob___sVolume');
        range.setAttribute('aria-label', 'Screen audio volume');
        range._dropdownItem = client.createResponsiveDropdownRangeItem(range, 'Screen audio volume', 'fa-desktop');
        document.body.appendChild(range._dropdownItem);
        const gains = new Map();
        client.getOutputGainNode = elem => {
            if (!gains.has(elem.id)) gains.set(elem.id, { gain: { value: 1 } });
            return gains.get(elem.id);
        };
        let broadcasts = 0;
        client.emitCmd = () => { broadcasts++; };
        client.handleScreenAudioVolume(range);
        await consumeAudio(client, 'tab', 'audioTab');
        const audio = document.getElementById('tab');
        const track = audio.srcObject.getAudioTracks()[0];
        const proxy = range._dropdownItem.querySelector('input');
        proxy.value = 20; proxy.dispatchEvent(new dom.window.Event('input'));
        assert.equal(range.value, '20');
        assert.equal(gains.get('tab').gain.value, 0.2);
        assert.equal(audio.srcObject.getAudioTracks()[0], track);
        assert.equal(track.enabled, true);
        assert.equal(broadcasts, 0);
        client.removeConsumer('tab', 'audio');
    });
});
