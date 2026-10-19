'use strict';

// HARDENED: no audio capture, upload, or transcription backend.
class WhisperTranscription {
    constructor() {
        this.isEnabled = false;
        this.mode = false;
        this.active = false;
    }
    toggleMode() { return false; }
    start() { }
    stop() { }
    setupAnalyser() { }
    getPeakLevel() { return 0; }
    recordSegment() { }
    sendBlob() { }
}
