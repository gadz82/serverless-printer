# Discovery consistency report

- Requirements: R-201–R-218 (18)
- Scenarios: 19 across five feature files

## Traceability

| Requirement | Scenarios |
|---|---|
| R-201 | rendering: real template, browser reuse, page settings/timeout |
| R-202 | pdfa: all levels, unsafe failure |
| R-203 | delivery: HTTP+ping, Lambda/EventBridge/S3, SQS FIFO |
| R-204 | delivery: allowlist/SSRF |
| R-205 | rendering: regression |
| R-206 | production: load test |
| R-207 | production: alarms/runbook |
| R-208 | production: plain/PDF-A smoke |
| R-209 | production: bootstrap/OIDC/rollback |
| R-210 | roles: deploy role network |
| R-211 | production: local Chrome file scoping |
| R-212 | roles: generated roles |
| R-213 | roles: provided roles |
| R-214 | roles: generated permissions |
| R-215 | roles: caller generated/output |
| R-216 | roles: separation |
| R-217 | roles: provided caller queue addition |
| R-218 | roles: caller trust |

## Checks

| Check | Result |
|---|---|
| Contradictions | None; the two-role split matches the approved clarification |
| Superseded decisions | Prior ADR-102–107 remain valid; role ownership extends them |
| Breaking changes | None; job/result contracts unchanged |
| Regressions | Render regression, contracts, LocalStack and smoke |
| Ambiguity | Resolved: caller role publishes jobs; worker role publishes results |
| Orphan requirements | None |
| Scope drift | None; no API/UI/DB/environments/upload/versioning |
| Secrets/PII | None in artifacts |

## Deferred inputs

Q-201 / A-201–A-206: throughput, AWS/VPC, alarms/callbacks, role trust/provided ARNs, branch
protection. None blocks G2.
