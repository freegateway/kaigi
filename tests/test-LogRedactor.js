'use strict';
const assert = require('node:assert/strict');
const util = require('node:util');
const proxyquire = require('proxyquire').noCallThru();
const { redact } = require('../app/src/LogRedactor');

describe('bounded log redaction', () => {
    it('redacts sensitive fields and sensitive objects without mutating input', () => {
        const input = {
            key: { value: 'bare-key-secret' },
            password: 'password-secret',
            credentials: ['credential-secret'],
            nested: { accessKeyId: 'access-secret', streamKey: 'stream-secret', token: 'token-secret' },
            count: 2,
        };
        const output = JSON.stringify(redact(input));
        assert(!output.includes('-secret'));
        assert.equal(input.key.value, 'bare-key-secret');
        assert.equal(JSON.parse(output).count, 2);
    });
    it('redacts URL credentials, query secrets and messages inside errors and causes', () => {
        const error = new Error(
            'Cannot connect https://url-user:url-password@example.invalid/?access%5Ftoken=query-secret'
        );
        error.cause = new Error('ldap://bind-user:bind-password@ldap.invalid');
        error.key = 'error-secret';
        const output = JSON.stringify(redact({ error, message: 'password=message-secret Bearer bearer-secret' }));
        for (const value of [
            'url-user',
            'url-password',
            'query-secret',
            'bind-user',
            'bind-password',
            'error-secret',
            'message-secret',
            'bearer-secret',
        ])
            assert(!output.includes(value), value);
        assert(output.includes('Cannot connect'));
        assert(output.includes('stack'));
        assert(!JSON.stringify(redact('https://user:password@tail@example.invalid/path')).includes('tail'));
    });
    it('handles cycles and limits without returning raw values', () => {
        const input = {};
        input.self = input;
        let current = input;
        for (let i = 0; i < 40; i++) {
            current.child = {};
            current = current.child;
        }
        current.value = 'deep-secret';
        input.items = Array.from({ length: 400 }, (_, i) => ({ key: `secret-${i}` }));
        const output = JSON.stringify(redact(input));
        assert(output.includes('[Circular]'));
        assert(output.includes('[Truncated]'));
        assert(!output.includes('deep-secret'));
        assert(!output.includes('secret-'));
    });
    it('does not invoke getters, custom inspectors or toJSON, and supports BigInt', () => {
        let called = 0;
        const input = {
            value: 12n,
            toJSON() {
                called++;
                return 'json-secret';
            },
            [util.inspect.custom]() {
                called++;
                return 'inspect-secret';
            },
        };
        Object.defineProperty(input, 'getter', {
            enumerable: true,
            get() {
                called++;
                return 'getter-secret';
            },
        });
        const output = util.inspect(redact(input));
        assert.equal(called, 0);
        assert(!output.includes('-secret'));
        assert(output.includes('12'));
        assert.doesNotThrow(() => JSON.stringify(redact(input)));
    });
    it('protects every Logger severity in text, JSON and pretty JSON', () => {
        for (const json of [false, true])
            for (const pretty of [false, true]) {
                const Logger = proxyquire('../app/src/Logger', {
                    './config': { system: { console: { json, json_pretty: pretty, debug: true, colors: false } } },
                });
                const lines = [];
                const original = Object.fromEntries(
                    ['debug', 'log', 'info', 'warn', 'error'].map((name) => [name, console[name]])
                );
                try {
                    for (const name of Object.keys(original)) console[name] = (...args) => lines.push(args.join(' '));
                    const logger = new Logger('Test');
                    for (const name of Object.keys(original))
                        logger[name]('Failed https://user:message-secret@example.invalid', {
                            key: 'field-secret',
                            error: new Error('ldap://user:error-secret@ldap.invalid'),
                        });
                    logger.jsonLog('info', 'Test', 'Extra', {}, { key: 'extra-secret' });
                } finally {
                    Object.assign(console, original);
                }
                assert.equal(lines.length, 6);
                assert(!lines.join('\n').includes('-secret'));
                if (json) for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
            }
    });
});
