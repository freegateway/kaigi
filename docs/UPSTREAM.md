# Upstream intake

Source: https://github.com/miroslavpejic85/mirotalksfu

The initial Kaigi parent is `bb49feb24ed35938cd7cd6916ddd2256cacb1c20`.
The canonical HARDENED transformation originates at `e3b483809c6642c7c5be274d592f9df2e75de625`.

| Reviewed upstream work through bb49feb | Initial disposition |
| --- | --- |
| Device contention recovery, responsive controls, settings search, panel/grid animations | Adopted with fixed identity, locale and privacy reconciliation |
| Noise default/personal preference | Adapted; preserve saved choices, no URL overrides |
| Presenter noise controls, role delegation and end-for-all | Excluded server-side |
| Gravatar and external browser resources | Excluded/replaced with local assets |
| bb49feb Safari audio activation and lifecycle fixes | Adopted; actual browser verification remains a release gate |
| db81a5e transport recovery | Adapted; false-success failure handling corrected with regression tests |
| API meeting-end reason | Retained behind existing administrative API boundary; no participant authority |
| Non-member log changes | Structured HARDENED security events retained |
| mediasoup 3.30.1 / client 3.24.5 | Node lock adopted; matching FreeBSD worker build/install still required |
| Nodemailer 10.1.3, js-yaml 5.5.0, jsdom 30.1.3, qs 6.16.1 | Adopted in curated dependency graph |
| AWS, hosted AI, Sentry and excluded integration dependencies | Excluded; no bulk cloud-SDK refresh |
| RNNoise standalone wasm | Inherited; exact source/rebuild provenance and browser audit pending before release |

Reviewed does not mean adopted unchanged. For subsequent work, record the exact
upstream hash, affected behavior, disposition, Kaigi commit and validation.
Fetch upstream for comparison; never automatically sync it into Kaigi main.

## Protected peer metadata (2026-10-21)

Adapted upstream `cd8633fbbd58192aa5011d698339b2c6e5aaa975`:
https://github.com/miroslavpejic85/mirotalksfu/commit/cd8633fbbd58192aa5011d698339b2c6e5aaa975

Reject client changes to `lobby` and `presenter` in `updatePeerInfo` and in
`producerClosed`, which also reaches the peer metadata mutator. Reject before
mutation, broadcast or producer closure, and use the fixed-field security logger
with reason `protected_peer_info`. Server-owned metadata transitions remain
available. Kaigi's existing admission middleware already blocks waiting sockets,
and presenter authorization always returns false; this change does not establish
that the upstream privilege escalation was exploitable in Kaigi.

Validation: seven Socket.IO/WebSocket regression cases exercise the production
namespace authentication middleware, admission/session middleware, relevant
handlers, Peer class and security logger in an isolated HTTP server. Session
lookup and media allocation are fixtures; no full daemon, browser media or
FreeBSD test is claimed. Cover protected fields through both events, rejected
waiting-socket traffic, log data minimization, valid peer updates and producer
closure, permitted admitted media requests and retained recording restrictions.
The complete application suite passed on Linux with Node 24.19.0: 403 Mocha
tests plus 23 security tests. Disabling only the two guards in the test's
in-memory source caused all four protected-field cases to fail, confirming
that the tests detect the missing protection.

The associated Chokidar 6 and AWS dependency changes are not adopted in this
targeted fix. The Kaigi commit is identified by the commit introducing this entry.

## Operator and attendee identity cleanup (2026-10-21)

Limit identity changes to operator documentation and supported UI output.
Correct installed LDAP/user/CSS samples, current security/privacy guidance,
translation instructions, branding fallbacks, reachable page footers, feedback
copy and the fallback avatar. Reuse the neutral local icon and existing login
footer; preserve normal document flow and administrator branding. Privacy
information describes deployment-dependent behavior instead of making claims
on behalf of an upstream service. New text has Japanese, en-CA and fr-CA entries;
other locales retain English fallback for these additions.

Mark inherited deployment/API examples as upstream references and prevent the
Ubuntu installer from deploying MiroTalk as though it were Kaigi. Upstream
copyright, About credits, historical records, graphics files and internal
cookies/storage/cryptographic/DOM/CSS names are retained. Do not apply cosmetic
renaming to implementation code when incorporating upstream changes.

Validation: 406 Mocha tests and 23 security tests passed on Linux/Node 24.19.0.
Focused DOM tests cover operator branding and local footer links on six pages,
text-only privacy localization in en-CA/fr-CA/ja, and fallback identity. Existing
About tests retain upstream credits and configured source/logo behavior. Actual
browser rendering, 150% display scaling and FreeBSD/Poudriere were not tested.

## Media and mail dependency update (2026-10-23)

Selectively adopt the dependency changes from upstream
`826d8cc61604b47f199a91a285ab2f263e491c26` and the preceding client fixes through
`fe9a5d6f88e0e56e4ab257eb09ba05f61563291b`:

- mediasoup 3.30.1 to 3.31.0. The FreeBSD package supplies the Node module and
  matching native worker; its separately maintained 3.31.0 port has been tested
  and installed locally and on the remote Poudriere system by the maintainer.
- mediasoup-client 3.24.5 to 3.25.3, rebuilding the locally served browser bundle
  with the locked esbuild tool. Preserve audio/video RTP header extensions with
  matching IDs regardless of SDP section order. Remove obsolete browser encoding
  `dtx`; apply the retained worker inactivity exemption to screen-video encodings
  in `Peer.createProducer()` instead. Audio's `opusDtx` codec option remains.
- Nodemailer 10.1.3 to 10.2.1. Retain the configured mail boundary and remove the
  SMTP password from application configuration logs. Scheduling remains disabled.

Primary diffs:
https://github.com/versatica/mediasoup/compare/3.30.1...3.31.0
https://github.com/versatica/mediasoup-client/compare/3.24.5...3.25.3
https://github.com/nodemailer/nodemailer/compare/v10.1.3...v10.2.1

The production dependency audit also identified existing advisories in two
retained transitive packages. Update only follow-redirects 1.16.0 to 1.16.1
(Axios) and ip-address 10.7.2 to 10.7.4 (express-rate-limit), after reviewing
their primary diffs. These patches repair cross-origin credential stripping and
quadratic IPv6-zone parsing respectively; no Kaigi exploit is demonstrated.

https://github.com/follow-redirects/follow-redirects/compare/v1.16.0...v1.16.1
https://github.com/beaugunderson/ip-address/compare/v10.7.2...v10.7.4
https://github.com/advisories/GHSA-q3jh-wrc6-jgq8
https://github.com/advisories/GHSA-8r9p-f939-6h3c
https://github.com/advisories/GHSA-rxp7-6hxx-x8q5

Validation: 418 Mocha tests and 23 security tests passed on Linux/Node 24.19.0.
New tests execute the shipped client bundle with mocked SDP offers in both media
orders, check browser and worker screen encodings, build Unicode mail and ICS
content, exercise a loopback SMTP refusal, check password-free configuration
logging, and verify cross-origin header stripping and bounded malformed IPv6
rejection. Both RTP-extension tests fail against the previous bundle. A fresh
production npm audit reports zero known vulnerabilities. No actual browser,
STARTTLS, native-worker or FreeBSD application test was performed here.

The port needs its application pin, mediasoup minimum version, npm-deps.mk and
distinfo updated after this application change is merged. This intake does not
adopt upstream presenter, countdown, cloud or promotional-page changes.

## Poll, breakout and mediasoup update (2026-10-27)

Adapt upstream security fixes:

- `44526587301509ab2d9f5305b848a216965a43ed`: validate poll indexes before
  lookup or mutation, reject malformed poll payloads/entries and invalid vote
  choices. Preserve ordinary poll operation and existing moderator restrictions.
- `46aba72670b198a84f1852432cd11b42904ef4d2`: reject all breakout socket
  operations, including enumeration and help, in production packet middleware.
  Kaigi excludes breakout controls rather than adopting presenter authorization.
  Both changes use fixed-field security logging without client payload data.

Selectively adopt `71a7c69a109109ef3387fce60713f64655023af7`: update mediasoup
3.31.0 to 3.32.0 and enable built-in BWE explicitly. Preserve configuration names,
passing initial/minimum outgoing and maximum incoming limits at transport
creation, with no post-creation setters. Preserve zero limits, existing transport
lifecycle handling and the independently updated 3.25.3 local browser bundle.
The maintainer has installed the separate mediasoup 3.32.0 FreeBSD port locally
and on the remote Poudriere server; integrated browser/media testing is pending.

The Kaigi port must raise its mediasoup minimum to 3.32.0 and update its application
pin/distinfo after merge. No port files or archives are included here. Public
upstream version footers, excluded RTMP/FFmpeg integrations and cloud-SDK bumps
are not adopted. An optional administrator-controlled Kaigi version display is
deferred from this security/media update.

Validation: 430 Mocha tests and 23 security tests passed on Linux/Node 24.22.1.
Six new WebSocket/Socket.IO cases run production authentication/admission
middleware, poll/breakout handlers and security logging against fixture sessions
and simultaneous meetings. Transport tests verify creation-time BWE/bitrate
options, zero/omitted limits, shared-server options and observer cleanup. No
native worker, browser media or FreeBSD application test was performed here.

## Socket rejection teardown (2026-10-27)

Kaigi-specific fix for queued Socket.IO middleware errors arriving after
disconnect cleanup removed the socket's error listener. Expected admission and
breakout denials now acknowledge and stop the packet without emitting an error;
live-session checks still disconnect missing/expired sessions. Disconnect cleanup
removes ordinary listeners but retains the error handler, which ignores errors
on an already disconnected socket. Process-wide uncaught-exception handling is
unchanged. Admission checks, session expiry and blocked breakout commands remain
enforced; ordinary admitted traffic is unaffected.

Regression tests use isolated child processes without uncaught-exception traps,
real WebSocket/Socket.IO bursts, and the production namespace/packet middleware,
error handlers and both disconnect cleanup branches. Session lookup and meeting
resources are fixtures, not a native worker or full-daemon deployment. The same
unadmitted-packet scenario crashes against the unfixed source.

Validation: 437 Mocha tests and 23 security tests passed on Linux/Node 24.22.1,
including seven child-process lifecycle cases. No FreeBSD or browser media test
was performed for this fix.

## Administrator metadata (2026-10-23)

Kaigi-specific correction: render PAGE_TITLE, META_DESCRIPTION and Open Graph
metadata in initial page HTML. Twitter-card text follows OG_TITLE and
OG_DESCRIPTION. Each field has independent administrator/localized overrides;
visible SITE_DESCRIPTION translations cannot replace explicit metadata values.
Default-language HTML and browser language changes share the same resolved
values. Text is escaped, empty metadata overrides remain empty, and public
previews contain no request or meeting context. Existing page templates and
upstream attribution are retained. Samples include Japanese, en-CA and fr-CA.

Validation: 423 Mocha tests and 23 security tests passed on Linux/Node 24.19.0.
New HTTP/JSDOM tests inspect initial HTML without executing JavaScript, metadata
precedence, browser language changes, empty settings, escaping and private
meeting-context separation. No browser rendering, preview-app cache or FreeBSD
test was performed. No dependency or port metadata changes are included.

## Local screen-share notice (2026-10-27)

Kaigi-specific UI change: replace only the local screen producer's visible preview
with a text notice and Stop sharing button. Keep its hidden media element and
track attachment for existing stop, track-ended and recovery cleanup; do not
change screen/audio production or remote consumer rendering. Do not auto-pin or
offer local picture-in-picture/fullscreen controls for this notice. Camera
previews retain their existing path. Add Japanese, en-CA and fr-CA translations,
with English fallback keys in other catalogues. Text uses the existing local
translation observer and supports live language changes.

Regression coverage checks hidden media, unchanged source tracks, stop delegation,
normal cleanup/recreation and live localization. Actual browser capture, short
viewports, 150% scaling and FreeBSD media testing remain separate checks.
