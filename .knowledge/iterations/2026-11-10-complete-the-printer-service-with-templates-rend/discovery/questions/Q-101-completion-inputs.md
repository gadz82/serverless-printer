# Questionnaire Q-101 — Completion inputs

- Status: **Deferred** — none of these answers changes product scope or the intent gate.
- Round: 1
- Owner: human release owner / operator

## Q-101.1 — What is the throughput target?

**Why:** the spec leaves it open, and it drives memory, concurrency and the load test.

**Candidate:** 10 jobs/minute peak, 20-page documents, p95 under 30 seconds.

**Risk if deferred:** the load test and `maximum_concurrency`/memory tuning use a candidate target
that may not match production.

**Assumption:** A-101.

## Q-101.2 — Which AWS account, region and VPC mode should the first cloud run use?

**Why:** bootstrap, OIDC, the state backend and the optional network module are account-scoped.

**Candidate:** operator account, `eu-central-1`, `vpc_mode = none` for the first release, then
test `create`/`lookup` separately.

**Risk if deferred:** cloud verification remains unexecuted; local and CI checks still run.

**Assumption:** A-102.

## Q-101.3 — Which real template ships first?

**Why:** Phase 2 exits when a template renders by id and slug after deploy.

**Candidate:** `generic-report` with the sample data from the spec layout.

**Risk if deferred:** the release smoke still uses `_smoke`; the real-template exit criterion is
not met.

**Assumption:** A-103.

## Q-101.4 — Which alarm topic and callback targets/allowlist are used?

**Why:** alarms and HTTP callbacks need operator-owned destinations.

**Risk if deferred:** alarms stay off and HTTP callbacks are tested with fakes/LocalStack only.

**Assumption:** A-104.

## Q-101.5 — Is a staged split acceptable?

**Why:** the remaining work is roughly three phases and may exceed the token budget.

**Risk if deferred:** the G4 plan may exceed the stop threshold and require a forced split.

**Assumption:** A-105.
