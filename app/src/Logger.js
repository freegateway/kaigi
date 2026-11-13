'use strict';

const util = require('util');
const colors = require('colors');
const config = require('./config');
const { redact: sanitizeLogValue } = require('./LogRedactor');

config.system?.console?.colors ? colors.enable() : colors.disable();

const options = {
    depth: null,
    colors: config.system?.console?.colors || false,
};

const LOGS_JSON = config.system?.console?.json;
const LOGS_JSON_PRETTY = config.system?.console?.json_pretty;

function safeMessage(value) {
    const sanitized = sanitizeLogValue(value);
    return typeof sanitized === 'string'
        ? sanitized
        : util.inspect(sanitized, { ...options, customInspect: false, getters: false });
}

module.exports = class Logger {
    constructor(appName = 'miroTalkSfu') {
        this.appName = colors.yellow(safeMessage(appName));
        this.debugOn = config.system?.console?.debug;
        this.timeStart = Date.now();
        this.timeEnd = null;
        this.timeElapsedMs = null;
        this.tzOptions = {
            timeZone: process.env.TZ || config.system?.console?.timeZone || 'UTC',
            hour12: false,
        };
    }

    jsonLog(level, appName, msg, op, extra = {}) {
        const logObj = {
            timestamp: new Date().toISOString(),
            level,
            app: appName,
            message: msg,
            ...extra,
        };
        if (op !== '' && op !== undefined && op !== null) {
            logObj.data = op;
        }
        const sanitized = sanitizeLogValue(logObj);
        LOGS_JSON_PRETTY ? console.log(JSON.stringify(sanitized, null, 2)) : console.log(JSON.stringify(sanitized));
    }

    debug(msg, op = '') {
        msg = safeMessage(msg);
        if (this.debugOn) {
            this.timeEnd = Date.now();
            this.timeElapsedMs = this.getFormatTime(Math.floor(this.timeEnd - this.timeStart));
            if (LOGS_JSON) {
                this.jsonLog('debug', this.appName, msg, op, { elapsed: this.timeElapsedMs });
            } else {
                console.debug(
                    '[' + this.getDateTime() + '] [' + this.appName + '] ' + msg,
                    util.inspect(sanitizeLogValue(op), options),
                    this.timeElapsedMs
                );
            }
            this.timeStart = Date.now();
        }
    }

    log(msg, op = '') {
        msg = safeMessage(msg);
        if (LOGS_JSON) {
            this.jsonLog('log', this.appName, msg, op);
        } else {
            console.log(
                '[' + this.getDateTime() + '] [' + this.appName + '] ' + msg,
                util.inspect(sanitizeLogValue(op), options)
            );
        }
    }

    info(msg, op = '') {
        msg = safeMessage(msg);
        if (LOGS_JSON) {
            this.jsonLog('info', this.appName, msg, op);
        } else {
            console.info(
                '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.green(msg),
                util.inspect(sanitizeLogValue(op), options)
            );
        }
    }

    warn(msg, op = '') {
        msg = safeMessage(msg);
        if (LOGS_JSON) {
            this.jsonLog('warn', this.appName, msg, op);
        } else {
            console.warn(
                '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.yellow(msg),
                util.inspect(sanitizeLogValue(op), options)
            );
        }
    }

    error(msg, op = '') {
        msg = safeMessage(msg);
        if (LOGS_JSON) {
            this.jsonLog('error', this.appName, msg, op);
        } else {
            console.error(
                '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.red(msg),
                util.inspect(sanitizeLogValue(op), options)
            );
        }
    }

    getDateTime(color = true) {
        const now = new Date();
        const currentTime = now.toLocaleString('en-US', this.tzOptions);
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        const timestamp = `${currentTime}:${milliseconds}`;
        return color ? colors.cyan(timestamp) : timestamp;
    }

    getFormatTime(ms) {
        let time = Math.floor(ms);
        let type = 'ms';

        if (ms >= 1000) {
            time = Math.floor((ms / 1000) % 60);
            type = 's';
        }
        if (ms >= 60000) {
            time = Math.floor((ms / 1000 / 60) % 60);
            type = 'm';
        }
        if (ms >= (3, 6e6)) {
            time = Math.floor((ms / 1000 / 60 / 60) % 24);
            type = 'h';
        }
        return colors.magenta('+' + time + type);
    }
};
