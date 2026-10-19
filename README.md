# FreeGateway Kaigi

Kaigi is the FreeGateway Project's FreeBSD conferencing application, derived
from MiroTalk SFU by Miroslav Pejic and powered by mediasoup. It continues under
GNU AGPLv3; original authorship, copyright and dependency notices are retained.

This is a development baseline, not a production release. It combines the
HARDENED FreeBSD port with upstream commit
`bb49feb24ed35938cd7cd6916ddd2256cacb1c20`. See
[the baseline record](docs/BASELINE.md), [security policy](HARDENING.md), and
[upstream documentation](docs/UPSTREAM-README.md).

## Development

Use Node 24 and npm. Install with `npm ci --ignore-scripts`, then run `npm test`.
The suite supplies isolated test configuration; its signing key is test-only.
Browser vendor resources are frozen under `public/vendor` with their notices.
`npm run build:mediasoup-client` rebuilds the local client bundle. FreeBSD uses
its separately built, matching mediasoup worker; never silently download a
prebuilt worker during packaging.

Application behavior is maintained directly in this source tree. The files in
`packaging/freebsd` preserve service, configuration, manual and filter templates;
they are not a newly generated port. No application patch replay is needed.

## Configuration and deployment

The package-owned `app/src/config.js` loads `config.template.js`. Administrator
settings live in `/usr/local/etc/kaigi/kaigi.conf` by default. Set
`KAIGI_CONFIG_DIR` explicitly for another installation or test jail.
The FreeBSD service is `kaigi`, enabled with `kaigi_enable="YES"`; application,
runtime and log directories are `/usr/local/www/kaigi`, `/var/run/kaigi` and
`/var/log/kaigi`. Kaigi does not read MiroTalk configuration or share its JWT
secret. MiroTalk STANDARD can remain installed separately; configure distinct
listener addresses or ports when running both services.
Local account/JWT-secret provisioning remains the FreeBSD service's job.
LDAP is included in the dependency set but remains disabled until configured.
No production credentials or live deployment configuration belong in Git.

A release must set `KAIGI_SOURCE_URL` to the exact available Corresponding Source
for the deployed build, including required dependency and build/install material.
The default repository URL is a development pointer, not release certification.

Before installation, complete FreeBSD/Poudriere, LDAP, browser/media and
Corresponding Source checks listed in `docs/BASELINE.md`. First release tagging and rollout are separate changes.
