# Initial HARDENED source baseline

## Inputs and ancestry

- Fork: https://github.com/freegateway/kaigi
- Exact upstream/fork parent: `bb49feb24ed35938cd7cd6916ddd2256cacb1c20` (MiroTalk 2.6.48).
- Hardening input: `mirotalk-2.6.25_0.tar.gz`, SHA-256
  `4080071931d008a38cff6226c8901c317452874977909fe5d2b11e5d4a50ace2`.
- Its upstream parent: `e3b483809c6642c7c5be274d592f9df2e75de625`.
- All 86 patches were applied cleanly at that original parent, then the resulting
  source transformation was imported with a three-way reconciliation onto the
  fork parent. The nine conflicted paths were Server.js, ServerApi.js,
  package.json, package-lock.json, CustomizeRoom.js, Room.js,
  RoomClient.js, Transcription.js and Room.html (nine files total).
- Import includes the LDAP module, curated LDAP dependency manifests, browser
  assets, post-patch removals, config/service/manual/filter samples, and security
  transport tests. The original canonical port archive is unchanged.

## Intentional reconciliation

The new upstream UI/media/lifecycle fixes remain, except where they conflict
with HARDENED policy. No presenter authority or remote noise-suppression commands
are accepted; no direct/token-bearing invitations or embedded redirect protocol
is restored. Gravatar remains local initials; permission-retry guidance stays
local. The existing Canadian translations are retained and new keys carried over.
Existing stored noise preferences survive; only new users receive the configured
initial default. The server default is false unless explicitly enabled.

Producer recovery now detects thrown and silently failed production, retains
retry snapshots, preserves partial-attempt tracks before closing transports, and
never reports success when a required producer was not recreated. Test coverage
includes missing producers and the former false-success failure path.

The source config loader replaces port substitution tokens. LDAP support is
available but not enabled automatically. Configuration/service/path renaming is
not part of this baseline. `packaging/freebsd` is preserved input for a future
Kaigi port, not a completed installable port.

## Validation and release gates

`npm test` runs applicable upstream regression tests plus dedicated HARDENED
session, authorization, transport-deadline, scoped-logout and meeting-policy tests.
Tests for intentionally removed upstream behavior are retained as reference in
`tests/upstream-only`; see its README. Recording and reconnect assertions instead
exercise Kaigi's opaque local selection flow. English variants are allowed to
use the same English labels, while key and placeholder coverage remains tested.

Before a release or production deployment:

- Build/install/package in FreeBSD 15/Poudriere with the matching mediasoup 3.30.1
  worker. No native FreeBSD build is claimed by this source import.
- Exercise local and live LDAP deployments, including TLS/loopback/socket modes,
  group-union grants, timeout/logout/revocation and multiple concurrent users.
- Test Safari/iPad audio activation, device failure/recovery, muted media, screen
  plus tab audio, virtual backgrounds, reconnects, recording and 150% scaling.
- Capture browser and server traffic to verify the supported deployment boundary.
- Audit RNNoise wasm provenance, rebuild inputs and licensing for the exact binary;
  it was inherited from the fork, not rebuilt here. Preserve all required source.
- The inherited CSP still permits dynamic evaluation for existing local libraries;
  narrowing it needs a separate compatibility audit, not an untested removal.
- Publish and configure exact Corresponding Source for the deployed release;
  this development repository pointer alone is not a completed source offer.
- Review operational naming/migration and replace inherited deployment tooling
  before making a release. Source tests do not replace firewall/jail/live checks.

## Kaigi operational namespace

The follow-up namespace change replaces the initial compatibility paths with
`kaigi`: rc service/variables, `/usr/local/etc/kaigi/kaigi.conf`,
`/usr/local/www/kaigi`, `/var/run/kaigi`, `/var/log/kaigi`, manuals, log rotation
and filter examples. MiroTalk STANDARD remains independently installable.
There is no automatic import, alias or sharing of MiroTalk settings, users
or JWT secrets. LDAP settings remain under `etc/kaigi/ldap`.
Use separate listener addresses or ports for simultaneous services.
The original 13ce82a9 port archive predates this change and must be regenerated
with a new source pin before testing the separate Kaigi namespace.

## FreeBSD port ownership

The baseline history above records the original source import. Subsequent
namespace changes established the independent `kaigi` service and paths.
FreeBSD packaging is now maintained separately in
https://github.com/freegateway/kaigi-freebsd-port, initially imported from
`kaigi-0.1.0_2.tar.gz` pinned to application merge commit
`4a4acc3d1f4e279543b90fe88a276f322d4e06da`.

Application manuals, configuration examples and the application-specific
fail2ban filter remain under `packaging/freebsd`. The port reads these from
its fixed application pin. The service script, newsyslog template and package
message are owned by the port repository. Existing source commits and release
archives remain reproducible; no historical commit is rewritten.
