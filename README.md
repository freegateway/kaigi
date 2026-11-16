# FreeGateway Kaigi

Kaigi is a privacy-focused, self-hosted video conferencing system from the
[FreeGateway Project](https://www.freegateway.org/). It gives organizations
control over their meeting infrastructure, user access and data.

Kaigi is developed independently as a fork of
[MiroTalk SFU](https://github.com/miroslavpejic85/mirotalksfu), created by
Miroslav Pejic. It uses [mediasoup](https://mediasoup.org/) to handle WebRTC
media and retains the upstream authorship, copyright and licence notices.

## Conferencing

Kaigi provides video and audio meetings, screen sharing, chat, file transfer,
shared whiteboards and collaborative editing. Participants can choose their
devices, arrange video tiles and use locally supplied virtual backgrounds.
Administrators control site branding, public metadata, enabled languages and
meeting restrictions. Maintained language additions include Japanese, Canadian
English and Canadian French.

## Security

- **Authenticated, authorized participants.** Every attendee logs in and receives
  access to exact meeting grants. The server checks live sessions and permissions
  for navigation, meeting creation, socket connections and meeting events.
  Local accounts and optional LDAP authentication are supported, including
  deployments using Kojo's directory. LDAP uses a restricted search account and
  a separate user credential bind, with explicitly selected transport security.
- **Equal participant permissions.** No attendee gains presenter/host authority
  or control over another attendee's media, access or connection. Nobody can end
  the meeting for everyone. Chat and file-transfer identity checks and editor
  authorization supplement meeting admission checks.
- **Bounded sessions and connections.** Logout revokes the relevant browser
  session without logging out another session merely because it shares an IP.
  Configurable idle and absolute session limits apply; quiet admitted conference
  participation suspends idle expiry, never the absolute limit. Unauthenticated
  connections have bounded lifetimes.
- **Defensive input and logging boundaries.** Sanitization failures reject the
  affected operation. Security events use fixed fields without credentials or
  client-supplied log text. Operational logging includes credential redaction.
  A supplied Fail2ban filter supports optional administrator-configured banning;
  installing Kaigi does not automatically enable a firewall blocker.

Kaigi uses HTTPS and secure WebSockets for web pages and signaling, and encrypts
WebRTC media in transit.
This is not a claim of end-to-end encryption through the conferencing server:
the server and its administrator remain part of the trust boundary.

## Privacy and digital sovereignty

Browser scripts, styles, fonts, translations, emoji and supported background
resources are served locally. The supported interface does not load third-party
CDNs, hosted translation widgets or built-in tracking/analytics services.
Cloud integrations and automatic external public-IP lookups are excluded.
Keeping runtime resources on the operator's site avoids disclosing visits to
asset providers and removes their ability to change remotely loaded application
code independently of the site's deployment.

Site identity and customization remain administrator-controlled. Public Help,
About and Security pages expose only intended public information, not account
databases or deployment secrets. Meeting navigation uses opaque references
rather than meeting names or authentication tokens in navigation URLs.
Shared whiteboards and editor content are ephemeral; unsaved annotation drafts
remain private. Per-meeting recording restrictions disable Kaigi's own recording
paths, but cannot prevent operating-system capture or external recording.

Self-hosting is not a promise that a site records nothing or contacts no external
service under every configuration. Administrators may explicitly configure a
directory or connectivity relay, and users can open external links. Operators
must define their recording, log retention and privacy policies. See
[HARDENING.md](HARDENING.md) for protections, responsibilities and limits.

## One or several named instances

Every deployment explicitly names at least one instance. All configuration lives
under `/usr/local/etc/kaigi/NAME/`; there is no default instance or
top-level configuration fallback. The package supplies inactive templates and
provisioning instructions under `example/`, not usable credentials.

Instances share read-only application files but have separate accounts, signing
secrets, configuration, branding, browser origins, navigation cookies, logs and
runtime state. Service-wide preflight checks configured and live port allocations
before start/restart. Lifecycle operations are locked, and startup requires a
bounded acknowledgment after workers and the HTTP listener initialize.

Different ports do not create a strong isolation boundary by themselves. Use
separate service accounts, hostnames or jails where stronger separation is needed;
processes sharing a Unix account share its filesystem privileges. See
[named-instance administration](docs/INSTANCES.md) for setup, resource boundaries
and startup-safety behavior.

Kaigi is developed for FreeBSD. It is under active development; a stable
release has not yet been published.

## Getting started

Administrators configure accounts, meeting permissions, TLS and media networking
before opening the service to users. LDAP is optional and disabled by default.
For one instance set `kaigi_instances="staff"` in rc.conf; for several use, for
example, `kaigi_instances="staff public"`. Provision every named directory first.
No instance starts just because its directory exists. See the example directory's
README and the installed `kaigi(8)`, `kaigi.conf(5)` and `kaigi-ldap.conf(5)` manuals.
FreeBSD packaging is maintained in
[kaigi-freebsd-port](https://github.com/freegateway/kaigi-freebsd-port).
Application configuration examples and administrator manuals are kept here
under [packaging/freebsd](packaging/freebsd).

The inherited Ubuntu installer, Docker Compose files, and cloud/SIP/widget/RTMP
examples are upstream reference material, not supported Kaigi deployment tools.
In particular, the upstream Docker image runs MiroTalk, not Kaigi.

## User help

Open `/help` on your installation, or follow **Help** from the login and
meeting-selection page. The English, Japanese and Canadian French guide covers
joining, devices, meeting controls, screen sharing, collaboration, logout and
common problems. It uses your public branding, configured control labels and
local styles, shares the landing page's language preference and includes
collapsible section navigation.
The example controls are non-interactive and contain no real account or meeting
information. `/manual` redirects to the same guide; **Print / Save as PDF** uses
a print-specific layout. `/security` explains security and privacy in English,
Japanese and Canadian French; `/about` provides project credits and source links.

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
