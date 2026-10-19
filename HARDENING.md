# MiroTalk SFU: HARDENED build on FreeBSD

This document describes the inherited FreeBSD HARDENED policies now maintained
as Kaigi source at fork parent `bb49feb24ed35938cd7cd6916ddd2256cacb1c20`.
See `docs/BASELINE.md` for the canonical port input, reconciliation and remaining
release checks. Kaigi implements the FreeGateway
Project's Digital Sovereignty objectives: meeting infrastructure and routine
browser resources should remain under the administrator's control.

## Network and privacy behavior

- Browser scripts, styles, fonts, emoji data, virtual-background resources,
  and other bundled assets used by the supported interface are served locally.
  The Google Translate widget and its loader are removed. The language selector
  uses local translation files; missing translated strings fall back to English.
- Upstream automatic public-IP lookups against external services are removed.
  WebRTC listen and announced addresses are set by the administrator or
  resolved locally. The port does not configure a public STUN or TURN service
  by default. An administrator who supplies an external service changes this
  network and privacy boundary.
- Upstream analytics and telemetry, remote avatar generation, automatic
  third-party images, and external browser CDN loads identified in the port
  patches are disabled or replaced with local assets. User-initiated links to
  external sites, including upstream attribution links, remain links and may
  contact those sites when opened.
- Cloud-dependent features, including S3 upload, hosted AI services, external
  IP geolocation, Sentry, Discord, Mattermost, and ngrok, are disabled in
  HARDENED. The associated unused Node packages are removed from its curated
  dependency set where possible. This is not a claim that every remaining
  dependency has been independently audited.

## Authentication and secrets

- Local accounts and allowed meetings are configured in the root-only
  `etc/kaigi/users` file. The rc script reads it at startup. It creates a
  persistent random JWT signing secret in `etc/kaigi/jwt-secret` on first
  start. Keep both files owned by root and mode 0600.
- JWT secrets must contain at least 32 characters and must not use the published
  default. Authentication, recording-upload and RTMP tokens use independently
  derived keys; verification accepts only HS256.
- RustDesk remote-control requests and credential relaying are excluded.
- Every attendee must authenticate and be authorized for the selected meeting.
  This authorized-users-only model obviates upstream's host-first waiting
  machinery: an allowed user can open the pre-meeting page and start an empty
  meeting without waiting for a designated host. The old host-wait page
  redirects to login. Pre-meeting page access, meeting creation and socket
  joining each validate the live session and allowed-meeting permissions. HARDENED does not assign presenter status, use a lobby, or
  let a participant end the meeting for everyone. Each attendee leaves
  independently; the room closes when the last attendee leaves. Upstream
  presenter-only controls, such as breakout assignment and room-wide
  moderation, are unavailable in this build.
- The shared whiteboard exists only while a meeting is live. A late joiner
  receives a one-time snapshot from an attendee already in the meeting;
  further object updates remain live. The server does not retain a canvas.
  External image URL import is unavailable, including remote image sources
  submitted through the whiteboard socket. Local image-file import remains.
- `RP` in `meeting-properties.json` disables the built-in recording controls for exact
  meeting keys and rejects recording state and server recording uploads for
  those meetings. It cannot prevent OS screen capture or external recording.
- Screen sharing supports drawing and rich text annotations, with local PNG
  and PDF export. html2canvas 1.4.1 and jsPDF 3.0.4 are served from the local
  vendor directory; exports are created in the browser without an export
  upload. `RP` in `meeting-properties.json` restricts recording, not these snapshots.
  Export annotations before stopping the screen share.
- Active-room listing, scheduling and email invitations, RTMP streaming, and
  the support widget are disabled in HARDENED.
- Authentication tokens are held in browser session storage and sent through
  authenticated requests and socket messages, never navigation URLs. Meeting
  selection is authorized server-side. The pre-meeting page requires a live
  session cookie and an opaque selection belonging to that session. Direct
  meeting-name join URLs and breakout-entry helpers are blocked. Do not
  distribute tokens through links or log them through custom integrations.
- `AUTH_IDLE_TIMEOUT` limits inactivity and `AUTH_SESSION_MAX_AGE` imposes an
  absolute lifetime. Active meeting participation refreshes the idle timer,
  including when a participant is quiet. Expiry and logout invalidate the
  local browser token and its server-side session. See `kaigi.conf(5)` for
  defaults and disabling either limit.
- The application `config.js` under `www/kaigi/app/src` is package-owned
  code. Configure supported behavior in `etc/kaigi/kaigi.conf` instead.

## Administrator choices and boundaries

The in-meeting About dialog retains upstream MiroTalk SFU authorship and
contact information, identifies this as a FreeBSD HARDENED build of the
FreeGateway Digital Sovereignty Project, and links to the project's site,
the GNU AGPLv3 license, and the exact Corresponding Source for the package.
Those external links are followed only when a user chooses to open them.
The About page uses stable translation identifiers in the local language files;
the English legal wording is the fallback when a translation is unavailable.

The administrator controls listener addresses, TLS, WebRTC media addresses,
accounts, site assets, and the optional privacy-policy URL. `kaigi.conf`
can also pass upstream environment settings through to MiroTalk. Review such
settings before enabling integrations or supplying external URLs. A custom
site asset, user-posted link, shared screen, or administrator-selected remote
service can still expose data to its recipient. An upstream MiroTalk privacy
page is not a substitute for the deployment's own privacy policy.

HARDENED does not replace TLS deployment, firewall rules, operating-system
updates, package updates, or access-log policy. A browser necessarily
connects to the configured meeting host, and media connectivity depends on
the chosen network topology. The port does not claim end-to-end encryption
against the conferencing server or guarantee that every deployment has no
third-party traffic.

## Verification and updates

Validate the patches against the exact pinned upstream source and check
changed JavaScript syntax before packaging. Source-level checks do not
replace a FreeBSD/poudriere build, a live network audit of browser features
and server egress, or multi-user authorization and session-expiry testing.

When updating the upstream source or dependencies, recheck automatic browser
requests, server egress, token handling, and both build options. For a
deployment audit, record browser network traffic through login, meeting
selection, joining, chat, media and rejected direct-entry requests; inspect server
egress and access logs as well. `kaigi(8)` and `kaigi.conf(5)` describe
installation and supported settings.

## Speech recognition and transcription

HARDENED disables browser transcription, voice commands, speech-to-text chat input,
and video-assistant speech input. It contains no active speech recognition or
Whisper audio-capture implementation. Transcription commands are not relayed,
and the server rejects Whisper requests without processing audio or contacting
a backend. Environment settings cannot enable these features. Local annotation,
chat, and whiteboard exports remain available. STANDARD retains upstream behavior.

## LDAP authentication alongside local users

LDAP is optional and disabled by default. A username present in the users file is
always authenticated locally. An incorrect local password never triggers LDAP.
LDAP canonical usernames that collide with local accounts are denied, including
when the submitted LDAP login is an alias. LDAP does not modify the users file.

LDAP_ENABLED belongs in kaigi.conf; directory and authorization settings must be explicitly present in ldap/ldap.conf.
Operational defaults are documented in ldap.conf.sample and kaigi-ldap.conf(5).
Inherited LDAP environment variables are ignored. Kaigi includes the LDAP module, locked ldapts dependency, samples and manual; runtime LDAP_ENABLED defaults to false. Unknown LDAP variable names,
missing settings and invalid values cause startup failure. The sample contains
placeholders for directory-specific settings; no current FreeGateway DNs,
object classes, attribute names or group layout are assumed.

LDAP requires HOST_PROTECTED=true, HOST_USER_AUTH=true, HOST_USERS_FROM_DB=false
and OIDC disabled. The existing HTTP and OIDC integrations remain available
when LDAP is disabled. Empty local users files produce no example accounts.

Transport is explicitly selected: ldaps, ldap-starttls or ldap-plain.
Plaintext accepts only literal 127.0.0.0/8 or ::1 destinations, including the
cross-jail loopback addresses. TLS requires an explicit CA file; the minimum TLS version defaults to TLSv1.2; certificate verification cannot be disabled. Unix sockets and SASL
EXTERNAL are outside this implementation.

LDAP_USER_SCOPE and LDAP_GROUP_SCOPE accept base, one or sub. Administrator
filter templates use {username}, {member} and {group}; substituted values are
LDAP-escaped. Username/display attributes, membership representation (dn or
username), group searches and uniqueness searches are explicitly configured.
Exactly one user must match. The user password is checked on a separate LDAP
connection from the restricted search-account connection.

LDAP_GROUPS_ENABLED=false skips group retrieval and uses the explicitly configured default-group file.
With groups enabled, direct mode uses unique group names as meeting identifiers;
mapped mode uses the explicitly selected group name or DN in administrator-owned
`ldap/group-meetings.json`, whose groupMeetings object maps each group key
to a nonempty array of exact meeting keys. Grants are the union, with duplicates removed. Default groups apply only
after a successful lookup returning no relevant groups, never after a lookup
failure or when groups exist but are unmapped. A literal '*' LDAP key authorizes only that meeting; wildcard access
is reserved for explicitly configured local accounts. Meeting keys support
1–128 printable Unicode characters. Nested groups are not expanded.

Mappings are fully validated on every new LDAP login and atomically replaced.
Use files and a directory writable only by administrators. A malformed mapping
or directory outage denies new LDAP logins while local users continue working.

Session tokens contain identity and a server session identifier, never passwords.
The server records canonical username, display name, authentication source and
meeting grants. Those grants enforce both creation and joining. LDAP group and
account changes take effect at the next login; LDAP_SESSION_MAX_AGE bounds their
lifetime, with the shorter existing AUTH_SESSION_MAX_AGE also applied when set.
Existing idle expiry, active-meeting activity and logout/revocation remain.
Restarting the daemon invalidates existing sessions. No LDAP password is cached,
logged or used for subsequent meeting joins.

LDAP_BIND_PASSWORD_FILE must be an absolute path to a regular non-symlink file,
readable by the daemon, at most 4096 bytes, with no group-write or other access
(mode 0600 owned by the daemon, or 0640 with an appropriate daemon group).
Store a single password, optionally followed by one newline. LDAP credentials
are never included in the browser configuration. LDAP input accepts up to 256
username and 4096 password characters; local accounts retain their existing
1–36 character password rule.

### LDAP group names and meeting names

LDAP_MEETING_MODE=direct means each group name is itself an approved meeting
identifier. LDAP_MEETING_MODE=mapped resolves the union of all matching group
files. A meeting may appear in any number of group files; duplicates are removed.

LDAP_GROUP_SOURCE=user-attribute reads scalar or multi-valued group names from
LDAP_USER_GROUP_ATTRIBUTE on the authenticated user entry. These values are
names, not DNs; no group-entry lookup is needed. In mapped mode explicitly set
LDAP_MAPPING_KEY=name. An absent attribute means no groups only after a successful
unique-user search and password bind. Empty or malformed attribute values deny
access. No attribute name or membership schema is assumed.

LDAP_GROUP_SOURCE=group-search retains the separate group-entry search and explicit
membership filter. LDAP_MAPPING_KEY may then be name or dn. Name mappings and
direct meeting names require a uniqueness search using LDAP_GROUP_UNIQUE_FILTER;
ambiguous group names deny access. DN mappings retain unambiguous full-DN keys.

Example name-based mapping files:

```json
{"group": "Engineering", "rooms": ["engineering", "project-alpha"]}
```

```json
{"group": "Management", "rooms": ["management", "project-alpha"]}
```

Membership in both grants engineering, management and project-alpha. Filenames
are arbitrary administrative names; they are never derived from LDAP values.

### Default groups and group grants

`ldap/group-meetings.json` contains exactly `defaultGroups` (an array of group
keys) and `groupMeetings` (an object mapping group keys to meeting-key arrays).
Default groups apply only when successful LDAP authentication returns no groups;
they never supplement existing membership or mask LDAP errors. Empty defaults
disable fallback. The direct/mapped resolver applies to defaults too.

The whole policy is validated on each login and atomically replaced. Grants are
the union of matching groups with duplicate meetings removed. Malformed or
unsafe existing files deny LDAP login. A missing file in mapped mode denies
login; direct mode allows it with no defaults. No groups or no grants denies
a login session and produces the localized no-meetings alert.

### Optional packaging and LDAP directory layout

Kaigi includes LDAP support and its configuration samples. Runtime LDAP_ENABLED
defaults to false. Local authentication and password-free sessions do not require
LDAP. MiroTalk STANDARD is maintained independently in its own port.

Only LDAP_ENABLED remains in kaigi.conf. The remaining settings live in
/usr/local/etc/kaigi/ldap/ldap.conf, with ldap.conf.sample installed using
package sample-file preservation. Supporting files are ldap/bind-secret,
ldap/group-meetings.json. No bind secret is generated or installed;
administrators create it with the protected permissions documented above.
ldapi is reserved but unimplemented. The accepted transports are ldaps,
ldap-starttls and ldap-plain; plaintext remains loopback-only.


## Included and excluded upstream features

Pinned source: 597c4506f079290d332de373e3e6433b4286d5fa.
HARDENED excludes SIP controls, browser client and initialization, and excludes
Anam's browser SDK, provider and server handlers. The new shared VideoAI provider
modules are not installed; the existing disabled external VideoAI policy remains.
Native translation is mandatory: no Google translation selector or browser mode
override is included. The local WebRTC network monitor is retained and does not
send its measurements to an external analytics service.

LDAP server diagnostics now identify settings, file constraints and operations,
without passwords or secret contents. Public login failures remain generic except for the localized no-meeting-grants rejection.
ldap.conf.sample groups related settings with prominent REQUIRED labels,
conditional requirements, and documented operational defaults.
ldap/group-meetings.json consolidates default groups and group grants,
including shared meetings and union-based grants.

The locked dependency set pins proxy-addr 2.0.8, source-map-js 1.2.2 and
joi 17.13.8 through npm overrides. LDAP_ENABLED remains off by default.
LDAP improvements do not add ldapi support.

## Private meeting selection and invitations

HARDENED no longer generates meeting-name navigation or invitation URLs.
Users authenticate, select a meeting, and submit its name in an authenticated
POST body. The server checks the live session and its meeting grants before
issuing an opaque per-tab selection reference. The pre-meeting URL contains
only that random reference, never the meeting name. The reference alone grants
no access: the HTTP-only, Secure, SameSite=Lax host-scoped session cookie must
identify the same live server session, and meeting authorization is checked
again before serving the page. HTTPS is required. Up to 32 selections are
retained per session; older selections must be made again.

Legacy /join URLs and short meeting-name URLs cannot serve a meeting page.
Direct static access to HTML view templates is also blocked. Login no longer
honours meeting targets in query strings. Socket creation/join checks remain.
Logout, expiry and restart revoke navigation access through the existing
server-side session lifecycle. Existing browser sessions must log in again
to obtain the navigation cookie.

Invitations contain the basic site URL and the meeting name as separate text.
Native sharing and clipboard copying use that format; QR codes contain only
the basic site URL. The old email action copies the invitation rather than
constructing a mailto URL containing the meeting name. Breakout, embedding and
customized direct-join URL helpers are unavailable. REST API URL builders return
the basic site URL. Recording upload filenames use an opaque conference-instance
identifier, validated against the signed upload token; no meeting name appears
in recording upload URLs. Upload tokens are accepted only in Authorization headers.

These changes keep meeting names out of application-generated URLs. Names remain
visible to authorized participants, the server, explicit authorization logs,
and separately shared invitation text. They are not an end-to-end secrecy claim.

## Meeting properties and group grants

`meeting-properties.json` maps stable meeting keys to `names` (localized
labels) and `restrictions` (capability restrictions). `RP` prohibits built-in
recording and server recording uploads, not OS capture or external recording.
An unlisted meeting displays its key and has no restrictions. Missing properties
also use these defaults. This optional file grants no meeting access.

Names use exact language, base language, English, then the key. Labels are shown
in meeting selection, pre-meeting information, headers and invitations. Only
authenticated users receive labels for their granted meetings; the public
branding endpoint does not publish the meeting catalog.

`ldap/group-meetings.json` maps stable LDAP group keys to stable meeting keys
and supplies optional default groups. Display attributes never affect matching.
Local account grants remain in the users file as a JSON array in its fourth
field, or an explicit * for local wildcard access. JSON arrays preserve commas,
pipes, Unicode and spaces inside keys.

Meeting keys contain 1–128 printable Unicode characters, including Japanese,
combining marks and punctuation. Control/format/surrogate/unassigned characters
and line/paragraph separators are rejected. Matching is exact, without Unicode
normalization or case folding. Keys are data, never filesystem paths or URLs.

Unknown properties/codes, duplicate JSON keys, malformed JSON, invalid values
or unsafe existing files are rejected. Policy files must be regular non-symlink
UTF-8 files no larger than 256 KiB and not writable by group or others. Meeting
properties are loaded at startup; restart after edits. Group grants are loaded
on each login. The rc script uses only the current `jwt-secret` filename.

## Annotation privacy

HARDENED sends text annotations to other participants only after Save.
Unsaved drafts are not broadcast; Cancel discards the local draft.

## Browser resource isolation

HARDENED sends a Content-Security-Policy restricting runtime resources to
this site. Embedded raster images, generated blob media and locally hosted
workers remain supported. WebSocket connections use this site and its
configured public host. Inline scripts/styles and dynamic functions remain
permitted for the existing local browser libraries; external script origins
are not permitted. The embedding policy remains independently enforced.

Virtual-background URL imports accept same-origin HTTP(S) images only and
refuse redirects. The renderer separately rejects external image sources,
including previously saved background settings. Local file uploads remain
supported. Remote geolocation commands are rejected server-side, the browser
handlers and prompts are removed, and Permissions-Policy disables geolocation.
LiveAvatar browser request paths, controls and the LiveKit vendor dependency
are removed. Normal links opened explicitly by users can still navigate to
external sites; the resource policy applies to resources loaded by MiroTalk.

Explicitly configured server-side integrations (such as LDAP, SMTP and
webhooks) remain administrator-controlled. Browser resource isolation does
not change their configured destinations.

## Admission, connection deadlines and security logs

Socket.IO namespace handshakes require a valid server-side authentication session.
Only admitted members may invoke meeting events; pre-meeting recording-policy,
creation and join requests retain explicit authorization checks. Creation tokens
use a separate HKDF-derived key, expire after two minutes, and are bound to both
the exact meeting and issuing session. Logout/session revocation invalidates them.

Silent initial TCP/TLS connections and incomplete initial HTTP requests have a
15-second deadline. HTTP request, headers, idle and keepalive deadlines and a
30-second Engine.IO authentication deadline are configurable in kaigi.conf.
Authenticated conference WebSockets remain exempt from HTTP inactivity limits.
The application obtains client addresses directly from the socket: forwarding
headers are ignored. A reverse proxy therefore requires a separately reviewed
trusted-proxy policy before IP-based blocking can identify individual clients.

Security events are single-line JSON in /var/log/kaigi/kaigi.log, with
component `conference-security`, timestamp, stable event, verified peer IP and
fixed reason. They contain no credentials, tokens, usernames or LDAP attributes.
These lines supplement existing operational logs. Only repeated
`authentication_failed` events should initially trigger automatic bans. Backend
outages emit `authentication_error` and are not matched. Duplicate
login, missing grants, meeting denials and single connection timeouts are not
password attacks and are not matched by the supplied filter.

### Optional Fail2ban deployment

The port does not install or start a blocker. Copy `files/fail2ban/kaigi.conf`
from the port to /usr/local/etc/fail2ban/filter.d/conference.conf. Configure a
Fail2ban jail with filter=conference, logpath=/var/log/kaigi/kaigi.log,
maxretry=5, findtime=900, bantime=900, usedns=no and appropriate ignoreip entries.
On a jail host, run Fail2ban on the host and point logpath at the jail's log path.

Use one dedicated firewall table for Conference and a rule scoped to TCP 7443.
For PF use a PF action supported by your installed Fail2ban version; for IPFW use
its bsd-ipfw action. Review their table/rule ownership and rule order locally;
existing firewall policies differ. Test the filter with fail2ban-regex before
activation. Do not have sshguard and Fail2ban independently manage the same table.
Conservative thresholds are necessary when multiple users share an IP address.

## Browser privacy and smaller viewports

RustDesk setup pages and handlers remain excluded, avatars use only validated
local/embedded images or generated initials, and typing indicators default off.
Background manifests are local, reject redirects and permit only packaged paths.
Multiple local-image uploads handle browser storage failure without hanging.
Login/meeting selection and their footer stay in normal document flow so the
page can scroll on a 1920x1080 display with 150% scaling.
