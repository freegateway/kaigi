# Kaigi development rules

- This repository is canonical application source. Work directly in source and
  tests; the FreeBSD port packages fixed Kaigi releases. Do not rebuild the
  application from a MiroTalk patch stack.
- Preserve the policies in HARDENING.md. Every attendee authenticates and has
  exact server-enforced meeting grants. Keep opaque navigation, session-bound
  creation capabilities, revocation, scoped logout, and bounded pre-authentication
  connection lifetimes. Quiet admitted meetings suspend idle expiry, never the
  absolute lifetime limit.
- No participant is a presenter/host or can control another participant's media,
  admission, authorization, or connection. Deny prohibited commands server-side;
  hiding a control is insufficient. Preserve shared ephemeral whiteboards and
  late-join synchronization.
- Keep browser assets local and cloud integrations excluded. Unsaved annotation
  drafts are private; chat typing is administrator-opt-in. Respect recording
  restrictions and fixed identity fields. Keep security logs structured and free
  of credentials/tokens. Client-supplied proxy headers are not verified identity.
- Preserve local/LDAP behavior, restricted search plus separate credential bind,
  explicit transport security, exact union-based grants, and configured fallbacks.
- Maintain supported additions in Japanese, en-CA and fr-CA. Test short viewports
  and 150% scaling; preserve normal-flow footers.
- Inspect upstream diffs and record adopted, adapted, deferred or excluded work
  in docs/UPSTREAM.md. Never blindly merge upstream main or refresh dependencies.
- Preserve upstream copyright, credits, licensing and complete Corresponding
  Source obligations. Add FreeGateway attribution without replacing authorship.
- Run npm test and relevant checks. Report FreeBSD/Poudriere and actual browser
  testing separately from mocks, source inspection and Linux checks.
- The existing service/path names remain until a reviewed migration changes
  them. Generate no port/release archives, tags or PORTREVISION bumps unless
  explicitly requested. Follow the FreeBSD Port Workflow for packaging work.
