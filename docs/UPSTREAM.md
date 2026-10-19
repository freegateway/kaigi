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
