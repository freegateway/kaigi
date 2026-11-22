'use strict';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 16384;
const acknowledgements = new Set([
    'getMeetingRecordingPolicy', 'createRoom', 'join', 'getRouterRtpCapabilities', 'createWebRtcTransport',
    'connectTransport', 'restartIce', 'produce', 'consume', 'produceData', 'consumeData', 'pauseProducer',
    'resumeProducer', 'resumeConsumer', 'getPeerCounts', 'getRoomInfo', 'getChatGPT', 'getDeepSeek',
    'getWhisperTranscription', 'talkToOpenAI', 'getRTMP', 'startRTMP', 'startRTMPfromURL', 'exitRoom',
    'getRecUploadToken',
]);
const optionalPayload = new Set([
    'getRouterRtpCapabilities', 'getRoomInfo', 'getRecUploadToken', 'exitRoom', 'getProducers',
    'getDataProducers', 'refreshParticipantsCount', 'requestWhiteboardSnapshot', 'fileAbort',
    'editorReady', 'updatePoll', 'stopRTMP', 'endOrErrorRTMP', 'stopRTMPfromURL', 'endOrErrorRTMPfromURL',
    'setPresenterRole', 'createWebRtcTransport', 'getWhisperTranscription',
]);
const fields = {
    getMeetingRecordingPolicy: { room_id: text, peer_token: text },
    createRoom: { room_id: text, peer_token: text, token: text },
    join: { peer_info: object },
    connectTransport: { transport_id: text, dtlsParameters: object },
    restartIce: { transport_id: text },
    closeTransport: { transport_id: text },
    produce: { producerTransportId: text, kind: value => ['audio', 'video'].includes(value), appData: object, rtpParameters: object },
    consume: { consumerTransportId: text, producerId: text, rtpCapabilities: object },
    produceData: { transportId: text, sctpStreamParameters: object },
    consumeData: { consumerTransportId: text, dataProducerId: text },
    pauseProducer: { producer_id: text },
    resumeProducer: { producer_id: text },
    resumeConsumer: { consumer_id: text },
};

// Install before any application listeners, including those registered by helpers.
// Admission/session middleware still runs first. No packet payload or error text is logged.
module.exports = function guardSocketEvents(socket, securityEvent) {
    const register = socket.on;
    let reports = 0;
    socket.on = function (event, listener) {
        if (typeof listener !== 'function') return register.call(this, event, listener);
        const lifecycle = ['disconnect', 'disconnecting', 'error', 'clientError'].includes(event);
        const wrapped = function (...args) {
            if (lifecycle) return invoke();
            const originalAck = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
            let replied = false;
            const ack = originalAck && ((...values) => {
                if (replied) return;
                replied = true;
                originalAck(...values);
            });
            if (ack) args[args.length - 1] = ack;
            const reject = (reason, disconnect = false) => {
                if (reports++ < 10) securityEvent('socket_event_rejected', socket, reason);
                try { ack?.({ error: 'Invalid request' }); } catch {}
                // A failed handler may have allocated media or changed state. Run normal cleanup.
                if (disconnect) socket.disconnect(true);
            };
            const data = args[0];
            if ((acknowledgements.has(event) && (args.length !== 2 || !ack)) ||
                (!optionalPayload.has(event) && !object(data)) ||
                (fields[event] && (!object(data) || !Object.entries(fields[event]).every(([key, valid]) => valid(data[key]))))) {
                reject('invalid_event_arguments');
                return;
            }
            try {
                return Promise.resolve(listener.apply(this, args)).catch(() => reject('event_handler_failed', true));
            } catch {
                reject('event_handler_failed', true);
            }

            function invoke() {
                try {
                    return Promise.resolve(listener.apply(socket, args)).catch(() => lifecycleError());
                } catch { lifecycleError(); }
            }
            function lifecycleError() {
                if (reports++ < 10) securityEvent('socket_event_rejected', socket, 'event_handler_failed');
            }
        };
        // Preserve EventEmitter's original-listener removal convention.
        wrapped.listener = listener;
        return register.call(this, event, wrapped);
    };
};
