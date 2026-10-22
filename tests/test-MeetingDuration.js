'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/Room.js'), 'utf8');
const initialization = source.slice(source.indexOf('let room_id = getRoomId();'), source.indexOf('let authSessionLastActivity'));
const queryHelpers = source.slice(source.indexOf('function getRoomPassword()'), source.indexOf('async function checkInitConfig()'));
const breakoutInitialization = source.slice(source.indexOf('function checkBreakoutRoom()'), source.indexOf('function returnToMainRoom()'));

describe('Kaigi ignores meeting duration URL parameters', () => {
    it('does not schedule departure or breakout navigation for valid, absent or malformed durations', () => {
        for (const duration of ['00:00:01', '00:30:00', null, 'unlimited', '00:99:99', 'invalid']) {
            for (const breakout of [false, true]) {
                const params = new URLSearchParams({ select: 'opaque-selection' });
                if (duration !== null) params.set('duration', duration);
                if (breakout) params.set('breakoutMain', 'untrusted-meeting');
                const scheduled = [];
                const queryReads = [];
                const context = {
                    console: { log() {} },
                    localStorageSettings: {},
                    getRoomId: () => 'authorized-meeting',
                    getPeerName: () => 'Authenticated attendee',
                    getPeerAvatar: () => false,
                    getPeerUUID: () => 'peer-id',
                    getPeerToken: () => 'live-session-token',
                    getQueryParam: (key) => { queryReads.push(key); return params.get(key); },
                    getId: () => null,
                    setTimeout: (...args) => scheduled.push(args),
                    setInterval: (...args) => scheduled.push(args),
                };
                vm.runInNewContext(`${queryHelpers}\n${breakoutInitialization}\n${initialization}
                    checkBreakoutRoom();
                    globalThis.result = { room: room_id, name: peer_name, token: peer_token };
                `, context);
                assert.equal(scheduled.length, 0, `duration=${duration}, breakout=${breakout}`);
                assert.equal(queryReads.includes('duration'), false);
                assert.equal(context.result.room, 'authorized-meeting');
                assert.equal(context.result.name, 'Authenticated attendee');
                assert.equal(context.result.token, 'live-session-token');
            }
        }
    });
});
