# Upstream reference tests

These files are retained from MiroTalk for historical comparison and are not
Kaigi tests. Their relative imports intentionally remain as originally written;
run them only against a matching unmodified upstream checkout.

- CreateRoomAuthorization / DirectJoinOIDC / JoinAuthorization assume upstream
  OIDC/host/direct-entry flows, including anonymous existing-room access. Kaigi
  instead tests authenticated sessions, exact grants, creation capabilities and
  admission through conference-security.cjs and kaigi-security.cjs.
- IntegrationRedirect assumes iframe/widget navigation, which Kaigi disables.
  Kaigi's recording/reconnect tests assert local authorized selection instead.
- RemoteControl / RemoteControlSetup exercise the excluded RustDesk feature.

Applicable upstream tests stay in the default suite; this directory is not a
place to move unexplained failures. Explain a deliberate product-policy change
and add its applicable security regression before retiring a test.
