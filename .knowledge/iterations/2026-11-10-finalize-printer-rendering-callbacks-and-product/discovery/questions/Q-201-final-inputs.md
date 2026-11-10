# Questionnaire Q-201 — Final inputs

- Status: **Deferred** — none blocks the discovery gate.
- Owner: human release owner / operator

## Q-201.1 — Confirm the throughput target

Candidate: 10 jobs/minute peak, 20-page documents, p95 under 30 seconds, with and without PDF/A.
Risk if deferred: load test/Power Tuning uses a provisional target. **Assumption A-201.**

## Q-201.2 — AWS account, region and VPC mode

Candidate: operator account, `eu-central-1`, `vpc_mode = none` for the first cloud run; test
create/lookup separately. **A-202.**

## Q-201.3 — Alarm SNS topic and callback targets/allowlist

Operator supplies the SNS topic, `callback_target_arns` and HTTP allowlist. Alarms stay off until
configured. **A-203.**

## Q-201.4 — Caller role trust and provided ARNs

Generated caller role default trusts the deployer account root; the operator may supply integrator
principal ARNs or a provided caller role ARN. **A-204.**

## Q-201.5 — Worker role mode

Default generated. A provided worker role must be same-account, trust `lambda.amazonaws.com`, and
be added to bootstrap `additional_worker_role_arns` for PassRole. **A-205.**

## Q-201.6 — Remote/branch protection

The operator pushes and enables branch protection plus the required CI checks. **A-206.**
