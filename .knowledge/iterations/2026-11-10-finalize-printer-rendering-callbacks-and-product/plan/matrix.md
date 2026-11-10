# Plan matrix — Final rendering, callbacks and production

| Prompt | Wave | Outcome | Depends on | Estimate | Status |
|---|---|---|---|---|---|
| P-201 — Chromium renderer | 1 | Lambda Chromium, shared page settings, browser reuse | — | L | pending |
| P-207 — caller/worker roles | 1 | Generated/provided roles, bootstrap PassRole, channel IAM | — | L | pending |
| P-202 — PDF/A archiver | 2 | All eight levels, ICC/XMP/Info/checks | P-201 | L | pending |
| P-203 — callback policy | 2 | Allowlist, DNS/link-local/metadata SSRF | — | M | pending |
| P-206 — local Chrome hardening | 2 | File requests scoped to the template dir | P-201 | S | pending |
| P-204 — delivery channels | 3 | HTTP/Lambda/SQS/EventBridge/S3 + ping + full worker wiring | P-201, P-202, P-203, P-207 | L | pending |
| P-208 — alarms/runbook | 3 | Opt-in alarms and operations runbook | P-207 | S | pending |
| P-205 — render regression | 4 | Reference PDFs, CI comparison, integration | P-201, P-202, P-204 | M | pending |
| P-209 — release smoke | 4 | Plain + PDF/A smoke, Chromium zip | P-201, P-202, P-204 | M | pending |
| P-210 — load/Power Tuning | 4 | Load harness, tuning docs, memory/concurrency | P-201, P-202, P-207 | M | pending |
| P-211 — cloud verification docs | 5 | OIDC/rollback/branch protection evidence checklist | P-207, P-209, P-210 | S | pending |

## Waves

1. P-201, P-207 (worker rendering vs infra/roles).
2. P-202, P-203, P-206.
3. P-204, P-208.
4. P-205, P-209, P-210.
5. P-211.

## Notes

- No feature branch; `main` integration.
- Cloud apply/verification is operator-run; P-211 documents the evidence checklist.
- Split Slice 3 at G4 if the cost/prerequisites demand it (ADR-202).
- Caller and worker roles stay separate; generated is the default.
