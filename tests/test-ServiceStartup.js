'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('service privilege drop', () => {
    it('uses the requested group and drops supplementary groups before UID', () => {
        const calls = [], module = { exports: {} };
        const process = {
            initgroups: (...args) => calls.push(['groups', ...args]),
            setgid: gid => calls.push(['gid', gid]),
            setuid: uid => calls.push(['uid', uid]),
            getuid: () => 123, getgid: () => 456,
        };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/src/ServiceStartup.js'), 'utf8'), {
            module, process, require: name => name === 'node:child_process'
                ? { execFileSync: command => command.endsWith('/id') ? '123\n' : 'kaigi:*:456:\n' } : {},
        });
        module.exports.dropPrivileges('kaigi', 'kaigi');
        assert.equal(JSON.stringify(calls), JSON.stringify([['groups', 'kaigi', 456], ['gid', 456], ['uid', 123]]));
        assert.throws(() => module.exports.dropPrivileges('', 'kaigi'));
    });
});
