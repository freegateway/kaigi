'use strict';

// HARDENED: transcription is unavailable; layout callers retain an inert interface.
class Transcription {
    constructor() {
        this.isTranscriptionSupported = false;
        this.transcriptionRunning = false;
        this.isPinned = false;
        this.slideOutTimer = null;
        this.isHidden = true;
        this.showOnMessage = false;
        this.sendToAll = false;
        this.whisper = new WhisperTranscription(this);
    }
    isSupported() { return false; }
    init() { }
    sendTranscript() { }
    showTranscriptionEmptyNoticeIfNoTranscriptions() { }
    handleTranscript() { }
    handleTranscriptionPopup() { }
    toggle() { }
    toggleBg() { }
    maximize() { }
    minimize() { }
    center() { }
    togglePinUnpin() { }
    isPin() { return false; }
    setPinControlState() { }
    pinned() { }
    pin() { }
    unpinned() { }
    save() { }
    delete() { }
    updateCountry() { }
    handleLanguages() { }
    handleTranscriptionAll() { }
    startAll() { }
    start() { }
    doStart() { }
    isAudioOff() { return false; }
    confirmStartWithAudioOff() { }
    stop() { }
    selectDisabled() { }
    updateSelectorsVisibility() { }
}
