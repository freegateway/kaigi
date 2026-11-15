'use strict';
const dns = require('node:dns').promises;
const os = require('node:os');

async function configureFreeBSDNetwork(config, { environment = process.env, lookup = dns.lookup, interfaces = os.networkInterfaces } = {}) {
    const infos = () => config.mediasoup.webRtcServerActive ? config.mediasoup.webRtcServerOptions.listenInfos : config.mediasoup.webRtcTransport.listenInfos;
    let announcedAddress = infos()[0].announcedAddress;
    const IP = infos()[0].ip;
    function updateListenAddress(ip) {
        for (const list of [config.mediasoup.webRtcServerOptions.listenInfos, config.mediasoup.webRtcTransport.listenInfos]) {
            for (const info of list) info.ip = ip;
        }
    }
    function updateAnnouncedAddress(address) {
        for (const list of [config.mediasoup.webRtcServerOptions.listenInfos, config.mediasoup.webRtcTransport.listenInfos]) {
            for (const info of list) info.announcedAddress = address;
        }
    }
    const webListenHost = environment.WEB_LISTEN_HOST;
    const explicitWebListenIp = environment.SERVER_LISTEN_IP;
    const explicitMediaListenIp = environment.SFU_LISTEN_IP;
    const mediaAnnouncedHost = environment.MEDIA_ANNOUNCED_HOST;
    const explicitMediaAnnouncedIp = environment.SFU_ANNOUNCED_IP;

    const resolveIPv4 = async (hostname) => {
        const addresses = await lookup(hostname, { family: 4, all: true });
        return [...new Set(addresses.map(({ address }) => address))];
    };

    if (!explicitWebListenIp && webListenHost) {
        const resolved = await resolveIPv4(webListenHost);
        const local = new Set();
        for (const entries of Object.values(interfaces())) {
            for (const entry of entries || []) {
                if (entry.family === 'IPv4') local.add(entry.address);
            }
        }
        const matches = resolved.filter((address) => local.has(address));
        if (matches.length !== 1) {
            throw new Error(
                `WEB_LISTEN_HOST "${webListenHost}" resolves to ${resolved.join(', ') || 'no IPv4 addresses'}, ` +
                    `but ${matches.length === 0 ? 'none is' : 'more than one is'} assigned to this host; ` +
                    'set WEB_LISTEN_IP explicitly'
            );
        }
        config.server.listen.ip = matches[0];
        if (!explicitMediaListenIp) updateListenAddress(matches[0]);
    }

    if (!explicitMediaAnnouncedIp) {
        const announcedHost = mediaAnnouncedHost || webListenHost;
        if (announcedHost) {
            const resolved = await resolveIPv4(announcedHost);
            if (resolved.length !== 1) {
                throw new Error(
                    `Media announced host "${announcedHost}" resolves to ${resolved.length} IPv4 addresses; ` +
                        'set MEDIA_ANNOUNCED_IP explicitly'
                );
            }
            announcedAddress = resolved[0];
            updateAnnouncedAddress(announcedAddress);
        }
    }

    if (!announcedAddress && IP === '0.0.0.0') {
        throw new Error(
            'No media announced address is configured. Set MEDIA_ANNOUNCED_IP, ' +
                'MEDIA_ANNOUNCED_HOST, or WEB_LISTEN_HOST.'
        );
    }

}

module.exports = { configureFreeBSDNetwork };

