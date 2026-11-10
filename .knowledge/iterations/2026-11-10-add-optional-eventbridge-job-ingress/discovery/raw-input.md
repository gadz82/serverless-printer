# Raw input

User request (2026-11-10): "ok proceed with missing pieces using orchid-sdd".

The missing functional item found during the post-handover SPEC audit is the optional
EventBridge job-ingress rule in SPEC §6.4:

> EventBridge rule (optional) | `job_rule = { bus_name, event_pattern }` → jobs queue. The rule
> is also named in the queue policy

The user chose to work directly on `main` for this small follow-up.

The local `template:preview --pdfa` gap found in the same audit was already fixed and committed
(`05ef6f9`); it is not part of this iteration.
