# Named Kaigi instances

One read-only Kaigi installation can serve several independently configured
processes. The FreeBSD service selects instances; the application never searches
other instances for missing settings, credentials or branding.

## Resource audit

| Resource | Scope |
| --- | --- |
| Application, browser assets and bundled translations | Shared, package-owned, read-only |
| TLS certificate and key | Administrator-selected; may deliberately be shared |
| kaigi.conf, users and jwt-secret | Per configuration directory |
| LDAP connection settings, group mappings and pools | Per configuration directory/process |
| Site assets, site translations and meeting properties | Per configuration directory/process |
| Sessions, revocation, grants, rate-limit counters and meeting state | Per process |
| Navigation cookie | Historical name for default; unique name for each named instance |
| Recordings | Legacy location for default; private state root for named instances |
| PID files, log and log-rotation target | Per instance, managed by the port |
| Web and TCP/UDP media ports | Administrator allocates distinct sockets/ranges |
| Firewall, fail2ban and shared service-account privileges | Host-level unless explicitly isolated |

RTMP, cloud recording uploads, hosted authentication and other excluded
integrations remain disabled. This work does not enable them or change
participant roles, exact meeting authorization, timeout or revocation policies.
Browser downloads, including local recordings, remain in the user's browser;
they are not server files. Whiteboards, editor content and meetings remain
ephemeral process state, not a new persistent database.

## Service configuration

The port's `kaigi(8)` manual describes named-instance provisioning and commands.
For example, `kaigi_instances="staff public"` selects two names; leaving this
setting unset retains the existing `default` instance. Include `default` in the
list explicitly if it should also run. Stop an instance before removing its name.

Each named instance needs its own `etc/kaigi/instances/NAME` directory containing
its configuration and users. Root reads `users` and `jwt-secret` at service
startup; keep those files mode 0600. The service account reads the non-secret
application configuration, its LDAP settings and public site assets. Grant only
the access that account needs; do not make the whole directory tree writable.

The service sets these launch-time environment variables; do not put them in
`kaigi.conf`:

- `KAIGI_INSTANCE`: lowercase name, at most 32 letters/digits/underscores,
  beginning with a letter; `default` preserves the legacy paths and cookie.
- `KAIGI_CONFIG_DIR`: absolute configuration directory. Mandatory for named instances.
- `KAIGI_STATE_DIR`: absolute private state directory. Mandatory for named instances.

Named instances require explicit web and media port settings and a public web URL
(or a hostname from which Kaigi constructs it). Allocate non-overlapping media
ranges across instances, as well as distinct web ports. WebRtcServer worker
allocations must fit inside the range. The service validates the whole configured
list before start/restart, even when one instance is selected. It rejects
overlapping TCP/UDP media reservations, web listeners and web/media intersections
on overlapping bind addresses, including wildcard and equivalent IPv6 forms.
It uses the same hostname resolver as the running application. Account for TCP
media fallback and any relay too.

Named recordings default to `KAIGI_STATE_DIR/recordings`. `RECORDING_DIR` can
select a relative subdirectory or an absolute path within that state root.
Paths outside it are rejected. The default instance retains `app/rec`, including
existing relative overrides; absolute overrides now resolve correctly rather
than being appended to the application source path.

Site assets are served directly from the selected configuration directory.
Missing assets return 404 rather than falling through to a legacy shared
`public/site-assets` link. Operator-owned symlinks remain the operator's
responsibility; do not link public assets to configuration or credential files.

Different ports create separate browser origins, not separate cookie or
same-site boundaries. Separate cookie names prevent accidental interference,
not a hostile service on another port impersonating the site. Use separate
hostnames/accounts or jails when stronger isolation is required. Processes using
the same service account have that account's filesystem privileges. Share neither
users nor JWT secrets unless deliberately accepting the resulting trust boundary.

## Startup and shutdown safety

Lifecycle commands run under one host-local service lock. Preflight validates
configuration, accounts/groups, JWT material, TLS certificate/key compatibility,
and existing instance/recording paths before stopping or starting any process.
It reads root-only local credentials before validating configuration and TLS under
the daemon account's UID, primary group and supplementary groups. It does not
authenticate against LDAP or start native workers. Individual checks are bounded.
A total worker count exceeding the CPU count produces a warning; worker counts
must be positive integers.

The service starts with a clean caller environment. Configuration overrides
belong in kaigi.conf, not inherited shell variables. Service launches sanitize
Node's environment before loading configuration; interactive npm launches retain
their environment interface. NODE_ENV defaults to production for the service.
No credentials appear in command arguments or preflight errors.

Root-owned launch snapshots preserve allocations still used by running instances
after configuration changes or removal from rc.conf. A pre-safety running instance
without a snapshot must be stopped once before starting another instance; restart
can validate the replacement plan for its selected instances first. Snapshots
include the acknowledged PID and process start time to detect stale identity.
They contain resource metadata, not credentials. Checks coordinate this
installation's rc-managed instances, not manually launched processes, other
applications/installations or other jails.

The application acknowledges readiness after worker initialization and HTTP listen
succeed. The service checks a fresh nonce, its Node PID and process start time.
kaigi_start_timeout defaults to 30 seconds (1..300). Failure returns nonzero and
signals only that launch's supervisor to terminate its child. If it has not exited
after five seconds, the service forcibly stops that launch's validated child and
supervisor. This cleanup can extend the readiness deadline by five seconds.
Remaining instances
are not started/restarted after a runtime failure; previously running or
successfully started instances remain. All-instance restart is sequential, not
transactional or zero-downtime. Resources, permissions and files can change after
preflight; runtime failures remain possible. Readiness confirms startup, not
future availability or successful conference media exchange.

Explicit stop/status accepts a valid name after removal from rc.conf, without
parsing application configuration. Stop without a name also discovers PID
directories, ignoring malformed configured names. It never deletes credentials
or recordings. Stale recorded identity is rejected instead of signaling another
process. Preflight rejects symlinks in existing configuration/state/recording
paths; this does not sandbox a compromised process changing writable paths later.
Use separate accounts or jails for stronger isolation.

## Checks

`npm test` includes two full application processes with real HTTP and Socket.IO
transports and a native-worker test double. It checks branding, cookies, exact
grants, cross-instance tokens, logout and shutdown independence. It is not a
native-media, browser or FreeBSD integration test.

The port has `/bin/sh` dispatch/preflight tests and a native FreeBSD-only test
using actual `rc.subr` and `daemon`, temporary paths and loopback fixture servers.
Run `node --test tests/test-rc.cjs` in the port checkout; the native test requires
root on a FreeBSD test machine. Linux runs explicitly skip that test.

Before deployment, test two real instances with distinct accounts, disjoint
ports and different branding. Verify simultaneous conferences, recording paths,
restart, stale PID handling, log rotation and port-scoped bans. Check that the
shared application tree can remain read-only and that separate service accounts
cannot read each other's state or LDAP credentials. No code or dependency copies
per instance are required.
