'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('production socket rejection and disconnect lifecycle', function () {
    this.timeout(15000);
    for (const mode of [
        'unadmitted',
        'breakout',
        'expired',
        'missing_session',
        'queued_error',
        'member_error',
        'valid',
    ]) {
        it(`survives a burst of ${mode} packets without an uncaught error`, () => {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/socket-teardown.cjs'), mode], {
                encoding: 'utf8',
                timeout: 10000,
                env: process.env,
            });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr + result.stdout);
            assert(JSON.parse(result.stdout.trim()).ok);
        });
    }
});
