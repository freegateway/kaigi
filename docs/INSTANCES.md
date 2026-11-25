# Named Kaigi instances

## Hostname-based HTTPS proxy deployment

Kaigi 0.8.0 adds WEB_MODE=proxy; direct HTTPS remains the default. Give each
instance a separate public HTTPS origin, such as staff.meet.example.com and
public.meet.example.com, on the same proxy IP/443. URL prefixes are unsupported.
Proxy connectivity never authenticates a participant or grants meeting access.

Example Unix backend in the staff instance's kaigi.conf:

```
WEB_MODE=proxy
WEB_URL=https://staff.meet.example.com
WEB_LISTEN_SOCKET=/var/run/kaigi/staff/session/staff.socket
WEB_SOCKET_MODE=0600
MEDIA_LISTEN_IP=192.0.2.10
MEDIA_ANNOUNCED_IP=192.0.2.10
MEDIA_MIN_PORT=40000
MEDIA_MAX_PORT=40100
MEDIA_NUM_WORKERS=1
```

Remove WEB_LISTEN_PORT and WEB_LISTEN_IP from copied samples for Unix mode.
WEB_LISTEN_HOST is unnecessary when public URL and media addresses are explicit.
Socket paths must be absolute, normalized, at most 100 bytes and free of symlinks.
Parents must belong to root or the service user and not be group/world-writable.
Omitting WEB_LISTEN_SOCKET as well as the TCP settings defaults to
/var/run/kaigi/NAME/session/NAME.socket. The rc service creates session/ with
the instance's service ownership and mode 0750, while its parent stays root-owned
to protect PID files and startup metadata. Readiness directories also live inside
session/. Before startup and after a confirmed stop, rc removes stale session
contents only if both the recorded application and supervisor processes are gone.
Custom socket paths outside session/ remain administrator-managed; existing
socket paths there prevent startup. Normal listener close removes its socket.

0600 permits only the service owner. For a different proxy account use 0660,
deliberately share the service's primary group with the proxy, and permit group
traversal of the runtime directory, never group write access. Keep secrets
owner-readable only and prefer separate service accounts per instance. Confirm
actual user/group and directory permissions on FreeBSD. Jails/chroots require
deliberate shared filesystem visibility; use TCP otherwise.

For a TCP backend omit WEB_LISTEN_SOCKET and configure instead:

```
WEB_MODE=proxy
WEB_URL=https://staff.meet.example.com
WEB_LISTEN_IP=127.0.0.1
WEB_LISTEN_PORT=7443
WEB_PROXY_IPS=127.0.0.1
```

WEB_PROXY_IPS is a comma-separated list of exact source IPs, not CIDRs or hop
counts. Bind a specific private/loopback address, use distinct instance ports,
and firewall backend access. Any local process able to use a trusted source IP
is inside this trust boundary; Unix permissions can narrow that boundary.

Proxy mode serves backend HTTP/WebSockets without backend certificates. The
edge must terminate HTTPS, overwrite Host with the exact WEB_URL authority,
overwrite X-Forwarded-Proto with https, and overwrite X-Forwarded-For with ONE
actual client IP. Remove Forwarded, X-Forwarded-Host and X-Forwarded-Prefix.
Do not append forwarding chains or enable legacy TRUST_PROXY. Wrong hosts,
Origins (when present), non-HTTPS forwarding and prefixes fail closed.
Verified attribution feeds session checks, rate limits, IP checks and security
logs. Before initial HTTP headers arrive, timeout logs cannot identify the
original client; the supplied Fail2ban filter matches failed logins only.

HAProxy configuration outline (adapt certificate, accounts and permissions):

```
defaults
    mode http
    timeout connect 5s
    timeout client 60s
    timeout server 60s
    timeout tunnel 1h

frontend kaigi_https
    bind :443 ssl crt /usr/local/etc/haproxy/kaigi.pem ssl-min-ver TLSv1.3 ssl-max-ver TLSv1.3
    acl staff_site hdr(host) -i staff.meet.example.com
    acl public_site hdr(host) -i public.meet.example.com
    http-request deny unless staff_site or public_site
    http-request del-header Forwarded
    http-request del-header X-Forwarded-Host
    http-request del-header X-Forwarded-Prefix
    http-request set-header X-Forwarded-For %[src]
    http-request set-header X-Forwarded-Proto https
    use_backend kaigi_staff if staff_site
    use_backend kaigi_public if public_site

backend kaigi_staff
    http-request set-header Host staff.meet.example.com
    server staff unix@/var/run/kaigi/staff/session/staff.socket

backend kaigi_public
    http-request set-header Host public.meet.example.com
    server public unix@/var/run/kaigi/public/session/public.socket
```

For TCP replace the backend server address with 127.0.0.1:7443, for example.
Preserve WebSocket upgrades and /socket.io/ without path rewriting. Idle tunnel
timeouts must accommodate Socket.IO heartbeats; avoid forced short lifetimes or
closure on reload. This routes each hostname to one instance, not a load-balanced
cluster, and requires no sticky sessions. WebRTC media still uses each instance's
separate TCP/UDP allocations; the HTTP proxy does not carry media.

Run npm test on FreeBSD with KAIGI_SKIP_UNIX_TESTS unset. That executes the real
Unix HTTP/WebSocket lifecycle test. Restricted development sandboxes may set
KAIGI_SKIP_UNIX_TESTS=1 explicitly, which reports that test pending, not passed.
Real TCP backend tests cover HTTP, namespace authentication rejection and silent
namespace expiry. HAProxy configuration, cross-account socket access, jail
visibility, Poudriere and browser/media behavior require system validation.
Confirm failed-login logs show the real client before enabling Fail2ban.

One read-only Kaigi installation can serve several independently configured
processes. The FreeBSD service selects instances; the application never searches
other instances for missing settings, credentials or branding.
Every deployment uses this layout, even with one instance. There is no implicit
or privileged default name and no active configuration at the top level of
`/usr/local/etc/kaigi`.

## Resource audit

| Resource | Scope |
| --- | --- |
| Application, browser assets and bundled translations | Shared, package-owned, read-only |
| TLS certificate and key | Administrator-selected; may deliberately be shared |
| kaigi.conf, users and jwt-secret | Per configuration directory |
| LDAP connection settings, group mappings and pools | Per configuration directory/process |
| Site assets, site translations and meeting properties | Per configuration directory/process |
| Sessions, revocation, grants, rate-limit counters and meeting state | Per process |
| Navigation cookie | Unique name for each instance |
| Recordings | Each instance's private state root |
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
For example, `kaigi_instances="staff"` selects one instance and
`kaigi_instances="staff public"` selects two. Start/restart fails when this setting
is absent or empty. Directories are never automatically enabled. Stop an instance
before removing its name; explicit stop/status also works afterward.

The package supplies only templates under
`/usr/local/etc/kaigi/example/`, including a provisioning README.
Copy that directory to a new name, rename `kaigi.conf.sample` and `users.sample`
to `kaigi.conf` and `users`, and configure network/TLS settings and real accounts.
Rename optional translations, meeting properties, CSS and LDAP examples only as
needed. The package never installs active accounts/configuration or a JWT secret.
Updates replace the templates, not your deployed instance files. No directory
name, including `example`, has special runtime meaning.

Each named instance needs its own `etc/kaigi/NAME` directory containing
its configuration and users. Root reads `users` and `jwt-secret` at service
startup; keep those files mode 0600. The service account reads the non-secret
application configuration, its LDAP settings and public site assets. Grant only
the access that account needs; do not make the whole directory tree writable.

The service sets these launch-time environment variables; do not put them in
`kaigi.conf`:

- `KAIGI_INSTANCE`: required name, at most 32 lowercase letters/digits/underscores,
  beginning with a letter. No implicit fallback.
- `KAIGI_CONFIG_DIR`: required absolute configuration directory.
- `KAIGI_STATE_DIR`: required absolute private state directory.

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
Paths outside it are rejected. Every instance uses `/var/db/kaigi/NAME` for state,
`/var/run/kaigi/NAME` for PID files, and `/var/log/kaigi/NAME/kaigi.log` for logs.

Site assets are served directly from the selected configuration directory.
Missing assets return 404 rather than falling through to shared application
files. Operator-owned symlinks remain the operator's
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
In ldap/ldap.conf, relative LDAP_BIND_PASSWORD_FILE and LDAP_TLS_CA_FILE paths
resolve against that instance's ldap/ directory. For example,
LDAP_BIND_PASSWORD_FILE=bind-secret selects ldap/bind-secret within that instance.
Explicit absolute paths remain unchanged, including intentionally shared CA files.
Validation errors identify the instance and logical resource (such as kaigi.conf,
users or the TLS private key), with a setting or parser line number when known.
Only catalogued explanations are printed, never configured values, raw dependency
exceptions or stacks. Unrecognized failures retain a generic resource-specific
message; inspector failures and timeouts are distinguished from invalid settings.

Root-owned launch snapshots preserve allocations still used by running instances
after configuration changes or removal from rc.conf. A pre-safety running instance
without a snapshot must be stopped once before starting another instance. A
single-instance restart can validate its replacement before stopping it; group
restart also checks old allocations because other selected instances remain live
until their turn. Stop the affected group before reallocating ranges that would
conflict during sequential restart. Snapshots
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
process. By default, preflight and service startup reject symlinks in existing
configuration/state/recording paths. Set `ALLOW_SYMLINKS=true` in the instance's
`kaigi.conf` to permit directory aliases (including a linked `/usr/local/etc/kaigi`).
The option uses the same declarative parser as other settings and cannot be
enabled by an environment variable. Allowed paths are canonicalized before
cross-instance overlap and recording containment checks; the rc script launches
with the validated canonical configuration/state paths. Dangling/cyclic links
and group/world-writable resolved directories are rejected, except root-owned
sticky system parents. `kaigi.conf` remains a regular, non-symlink file without
group/world write access. Credential, meeting JSON, socket and runtime-metadata
protections are independent and remain enforced.
This does not sandbox a compromised process changing writable paths later.
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

Service identity and LDAP secrets: the package creates the unprivileged
kaigi user and group. The service defaults to kaigi:kaigi and retains global
and per-instance daemon_user/daemon_group overrides. The root bootstrap loads
the root-owned mode-0600 LDAP bind secret once, then initializes supplementary
groups and drops to the configured group and user before starting the server
or mediasoup workers. Rotation requires restart. No secret is passed in argv,
new environment variables, launch plans or readiness files.
For interactive LDAP launches, the protected secret must be preloaded by the
service bootstrap; do not relax its permissions.

For HAProxy Unix-socket access, use WEB_SOCKET_MODE=0660 and grant the proxy
service account membership in the configured Kaigi group. Restart the proxy
to acquire that membership. Keep state directories mode 0700 and credentials
root-owned mode 0600. Before upgrading an existing deployment, stop Kaigi and
migrate ownership of each instance's writable state to the chosen service user;
do not change ownership of credentials or application code.
