
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-tests-'));
process.env.KAIGI_CONFIG_DIR = directory;
process.env.SFU_ANNOUNCED_IP = '127.0.0.1';
process.env.JWT_SECRET = 'kaigi-tests-only-never-use-for-deployment-0123456789';
exports.mochaHooks = { afterAll() { fs.rmSync(directory, { recursive: true, force: true }); } };
