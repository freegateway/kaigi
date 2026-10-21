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
