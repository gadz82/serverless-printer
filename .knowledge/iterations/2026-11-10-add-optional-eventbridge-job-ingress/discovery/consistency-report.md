# Consistency report

- The change implements a previously unimplemented optional SPEC §6.4 item; no existing
  requirement is contradicted or superseded.
- The job/result contract, worker, callbacks, PDF/A, templates, CI and bootstrap are unchanged.
- `job_rule = null` preserves the current default deployment and queue policy.
- No new cross-repo dependency; workspace mode is disabled.
- No blocking question remains; the user selected `main` and authorized the follow-up.
