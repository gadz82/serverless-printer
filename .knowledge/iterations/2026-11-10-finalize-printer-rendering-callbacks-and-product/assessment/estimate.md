# Estimate

| Slice | Prompts | Effort | Risk | Build tokens |
|---|---|---|---|---|
| 2 — Chromium/PDF-A/channels/roles | 7 | 7–9 days | 4/5 | 260k |
| 3 — Capacity/ops/cloud | 5 | 4–6 days | 3/5 | 160k |
| **Total** | **12** | **11–15 days** | | **420k + reviews** |

With reviews (~60k–80k) the total is ~480k–500k, under the 600k stop but above the 250k warning.
The plan may split Slice 3 into a follow-up if the estimate grows or an apply/cloud risk blocks.

## Work breakdown

| Wave | Outcomes |
|---|---|
| 1 | Chromium renderer + PDF/A archiver + shared page settings |
| 2 | Channel adapters + callback policy/allowlist + local Chrome hardening |
| 3 | Render regression + integration coverage |
| 4 | Role modes + bootstrap EC2/PassRole + alarms/runbook |
| 5 | Load/Power Tuning + plain/PDF-A smoke + cloud verification docs |

## Assumptions

- Throughput target confirmed before the load test.
- AWS/remote/VPC inputs available before cloud verification.
- Chromium packaging behaves on Node 24/x86_64.
- PDF/A best effort.
- Provided roles are owner-managed and same-account for the worker.

## Budget

- Warn 250k, stop 600k. Slice 2 alone ~260k crosses the warning; surface at G4.
- Split Slice 3 if the total approaches 600k or a cloud gate is unavailable.
