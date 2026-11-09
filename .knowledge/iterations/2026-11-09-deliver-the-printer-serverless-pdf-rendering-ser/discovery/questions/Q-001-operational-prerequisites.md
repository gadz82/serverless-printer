# Questionnaire Q-001 — Operational prerequisites for the first deploy

- Status: **Deferred** — none of these answers changes product scope or acceptance criteria.
- Round: 1
- Owner: operator / human release owner

## Q-001.1 — Which GitHub repository identity will own the project?

**Why:** the OIDC trust policy and release workflow must name `repo:<owner>/<repo>`; a wrong
value makes every deploy fail closed.

**Example:** `gadz82/serverless-printer`.

**Risk if deferred:** the code and Terraform remain parameterized; the first deploy cannot
authenticate until the real value is supplied.

**Answer / assumption:** A-001 — the operator supplies the remote later, as stated on
2026-11-09. The repository is initialized locally on `main`.

## Q-001.2 — Which AWS account and region host the single deployment?

**Why:** bootstrap creates real buckets and roles; the backend and resource ARNs are
account-scoped.

**Example:** account `123456789012`, region `eu-central-1`.

**Risk if deferred:** no cloud verification is possible in this iteration; local and CI checks
still run.

**Answer / assumption:** A-002 — the operator supplies the account and region before bootstrap.
The spec default region is `eu-central-1`.

## Q-001.3 — Who applies `bootstrap/` and when?

**Why:** the deploy role and artifacts bucket must exist before the first release workflow run.

**Risk if deferred:** the first automated deploy is blocked until an administrator applies
bootstrap once.

**Answer / assumption:** A-003 — an administrator applies bootstrap once before enabling the
release workflow; the exact identity is recorded before the first deploy.

## Q-001.4 — Is a placeholder PDF acceptable for the Phase 1 exit?

**Why:** the accepted increment scope is contracts plus a deployable skeleton; Chromium is
Phase 3.

**Risk if deferred:** none for the foundation, but the release does not yet prove real PDF
fidelity.

**Answer / assumption:** A-004 — yes, the placeholder proves the queue, storage, delivery and
release path; real rendering is accepted as the next increment.
