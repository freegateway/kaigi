# FreeGateway Kaigi

Kaigi is a privacy-focused, self-hosted video conferencing system from the
[FreeGateway Project](https://www.freegateway.org/). It gives organizations
control over their meeting infrastructure, user access and data.

Kaigi is developed independently as a fork of
[MiroTalk SFU](https://github.com/miroslavpejic85/mirotalksfu), created by
Miroslav Pejic. It uses [mediasoup](https://mediasoup.org/) to handle WebRTC
media and retains the upstream authorship, copyright and licence notices.

## Features

- Video and audio conferencing, screen sharing, chat and shared whiteboards.
- Authentication for every participant, with access limited to authorized meetings.
- Local user accounts and optional LDAP authentication.
- Equal participant permissions: no participant receives presenter authority
  over another participant's media, access or connection.
- Locally served browser assets and translations, without built-in third-party
  tracking or cloud-service integrations.
- A customizable site identity, with support for Japanese and other interface languages.

Kaigi is developed for FreeBSD. It is under active development; a stable
release has not yet been published.

## Getting started

Administrators configure accounts, meeting permissions, TLS and media networking
before opening the service to users. LDAP is optional and disabled by default.
FreeBSD packaging is maintained in
[kaigi-freebsd-port](https://github.com/freegateway/kaigi-freebsd-port).
Application configuration examples and administrator manuals are kept here
under [packaging/freebsd](packaging/freebsd).

Read the [security and privacy documentation](HARDENING.md) for the access
model, deployment requirements and limits of the privacy protections.
Administrator-selected external services and user-opened links can still
contact third parties.

## Development

Use Node.js 24 and npm:

```sh
npm ci --ignore-scripts
npm test
```

The test suite uses isolated configuration. Native mediasoup setup is a
separate installation step; the commands above prepare dependencies for testing.

See the [development rules](AGENTS.md),
[project provenance](docs/BASELINE.md) and
[upstream change record](docs/UPSTREAM.md) for contributor information.

## Licence and credits

Kaigi is distributed under the [GNU Affero General Public License, version 3](LICENSE),
without warranty. MiroTalk SFU and its contributors remain credited for their
work; dependency notices are retained with the bundled resources.

Operators must make the Corresponding Source for their deployed version
available, including its modifications and required build and installation
material.
