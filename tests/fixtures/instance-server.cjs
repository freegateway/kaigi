'use strict';

// Exercise the complete application over real HTTP/Socket.IO transports without
// starting a native mediasoup worker. This is not a media integration test.
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const original = Module._load;
const failWorker = process.env.KAIGI_TEST_WORKER_FAIL === '1';
Module._load = function (name, ...args) {
    if (name === 'mediasoup') return {
        version: 'test-double',
        createWorker: async () => { if (failWorker) throw Error('Fixture worker initialization failure'); return Object.assign(new EventEmitter(), {
            pid: process.pid, appData: {}, close() {},
        }); },
    };
    return original.call(this, name, ...args);
};
require('../../app/src/Server');
