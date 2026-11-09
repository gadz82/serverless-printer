# Logic review — Foundations increment

- Iteration: `2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser`
- Phase: logic review
- Verdict: **No code-level blocking finding. Release-readiness verification is deferred to the
  first remote/AWS run and needs human acceptance.**
- Scope reviewed: the integrated `main` tree after all 10 prompts, the PRD/TRD, every Gherkin
  scenario, the contracts, the worker, Terraform, CI and release workflow.

## What was verified

- 285 unit/contract/local tests pass, including all domain, contract, worker, manifest and
  LocalStack integration tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm exec prettier --check .`, `terraform validate`,
  `terraform fmt -check -recursive`, TFLint with the AWS ruleset, `orchid-sdd lint` (12 anchors,
  12 docblocks, 0 errors) and `orchid-sdd index --check` pass.
- The local queue → worker → S3 → SQS callback path passes with the placeholder PDF, including
  invalid-message, unknown-template, retryable, last-attempt and FIFO paths.
- The delivered behaviour matches the accepted Phase 1 scope: placeholder rendering, SQS-only
  delivery, PDF/A rejected, no API/UI/database/environments/template upload.

## Scenario walk

| Scenario | Verdict | Evidence |
|---|---|---|
| S-001 One job yields one result | Satisfied locally | Domain and worker tests; LocalStack integration success |
| S-002 refId echoed unchanged | Satisfied | Domain tests for string, number and object refIds; contract tests |
| S-003 Contract accepts a valid job | Satisfied | 174 contract tests; generated types compile |
| S-004 Contract rejects an invalid job | Satisfied | Invalid fixtures and handler invalid-message tests |
| S-005 Valid `_smoke` job stores a PDF and returns success | Satisfied locally | LocalStack integration + `pnpm smoke:local`; placeholder PDF by design |
| S-006 Unknown template fails without retry | Satisfied | Domain and LocalStack integration tests |
| S-007 Retryable failure retried then DLQ | **Partially verified** | Last-attempt logic tested; redrive policy configured; no five-receive end-to-end DLQ test |
| S-008 Last attempt sends a failure result | Satisfied | Domain and LocalStack integration tests |
| S-009 Prints expire and links are short-lived | Satisfied by configuration | Terraform lifecycle and presign TTL tests; no live S3 lifecycle wait |
| S-010 Only allowed senders enqueue | Satisfied by configuration | Queue policy reviewed; no live AWS policy evaluation |
| S-011 Worker cannot deliver to an unlisted target | Satisfied by configuration | Worker IAM reviewed; no live AWS policy evaluation |
| S-012 Release commit deploys through OIDC | **Deferred verification** | Workflow/config reviewed; cannot run without remote, TF_VARS and AWS |
| S-013 Non-release commit deploys a sha release | **Deferred verification** | Release value matrix reviewed; no remote run |
| S-014 Post-deploy smoke passes | **Deferred verification** | Smoke script tested locally; deployed smoke needs AWS |
| S-015 Rollback deploys an earlier release | **Deferred verification** | Workflow path reviewed; no remote run |
| S-016 Bootstrap creates the foundation | **Deferred verification** | Terraform validate only; no admin apply |
| S-017 Printer module creates runtime resources | **Deferred verification** | Terraform validate/plan-level review; no apply |
| S-018 A valid PR passes quality gates | **Deferred verification** | Workflow actionlint/local commands pass; no GitHub run |
| S-019 A failing contract/Terraform check blocks PR | **Deferred verification** | Workflow logic reviewed; no GitHub run |
| S-020 Non-conventional commit rejected | Satisfied | Commitlint/husky locally rejects malformed messages |
| S-021 Squash merge keeps main linear | Satisfied | All prompt integrations used squash merges; no merge commits |
| S-022 Local job completes against LocalStack | Satisfied | Integration test + smoke transcript |
| S-023 Local failure visible in the sink | Satisfied | Invalid/unknown-template integration tests |

## Business-rule check

- One message, one print: use case and handler tests.
- Queue is the only entry point: no API/UI; Terraform creates the queue only.
- Template identity by id/slug: manifest catalog and reserved `_smoke` handling.
- No versions/statuses/database: repository contains none.
- Prints never kept: one-day lifecycle and short presign TTL.
- `refId` echo and deterministic `printId`: tested.
- PDF/A option: contract supports it; Phase 1 rejects requests by configuration, never
  mislabels a standard PDF.
- No static AWS credentials: OIDC only in workflows; no keys in the repo.
- Conventional Commits and squash/linear history: enforced locally and in CI config.

## Findings and disposition

1. **Release-readiness verification is deferred (high).** S-012–S-019 require the GitHub remote,
   repository variables (`TF_VARS`, `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `TF_STATE_BUCKET`,
   `ARTIFACTS_BUCKET`), an AWS account and the bootstrap apply. No deployed smoke, OIDC apply,
   rollback, or GitHub CI run has happened. This is a delivery-risk acceptance, not a code defect.
2. **DLQ redrive is not exercised end-to-end (low).** The policy and last-attempt logic are
   tested; a five-receive DLQ integration test is a Phase 2 test-hardening item.
3. **LocalStack presigned URLs are HTTP (low).** The local success test normalizes the scheme for
   contract validation; production HTTPS remains unverified until AWS.
4. **Branch protection is not configured (medium).** The local repository has no remote yet.
   The operator must enable PR-only/squash/linear-history protection and allow the release bot
   to push the semantic-release changelog commit.
5. **KMS tag propagation and release recovery (medium).** The workflow retries apply, but the
   first real apply and partial-release recovery are unproven.
6. **No real PDF rendering or PDF/A (accepted).** Deliberate Phase 1 scope per ADR-003; the
   placeholder is not production rendering and the next increment replaces it behind the port.

## Scope check

No scope creep. Template tooling, Chromium, PDF/A conversion, non-SQS channels, load testing,
production alarms/runbook, API/UI/database and environments remain out of scope. The `_smoke`
template and minimal manifest are the accepted Phase 1 foundation.

## Recommendation

The code and local integration are ready for the first remote/AWS verification. Approve G6 with
the explicit acceptance that deployed release scenarios remain unverified until the remote and
AWS account are configured, or keep the iteration open until that verification completes.
