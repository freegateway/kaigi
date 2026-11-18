'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../app/src/LdapAuth.cjs');
const localRequire = createRequire(filename);

describe('LDAP startup secret', () => {
    function loader(stat = {}) {
        let reads = 0, closes = 0;
        const sync = {
            openSync() { return 7; },
            fstatSync() { return { isFile: () => true, uid: 0, mode: 0o600, size: 6, ...stat }; },
            readFileSync() { reads++; return 'secret\n'; },
            closeSync() { closes++; },
        };
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, require: name => name === 'node:fs' ? { ...sync, constants: fs.constants } : localRequire(name),
            URL, Buffer, process,
        });
        return { initialize: module.exports.initializeBindSecret, reads: () => reads, closes: () => closes };
    }
    it('reads once per process and never reloads a rotated file', () => {
        const h = loader(), config = { enabled: true, bindPasswordFile: '/private/bind-secret' };
        h.initialize(config); h.initialize(config);
        assert.equal(h.reads(), 1);
        assert.equal(h.closes(), 1);
    });
    it('rejects group access, wrong ownership and nonregular/oversized secrets before reading', () => {
        for (const stat of [{ mode: 0o640 }, { uid: 1000 }, { size: 4097 }, { isFile: () => false }]) {
            const h = loader(stat);
            assert.throws(() => h.initialize({ enabled: true, bindPasswordFile: '/secret' }));
            assert.equal(h.reads(), 0);
            assert.equal(h.closes(), 1);
        }
    });
});
