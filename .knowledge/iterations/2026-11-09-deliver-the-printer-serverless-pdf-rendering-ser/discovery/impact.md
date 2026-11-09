# Discovery impact — Foundations: contracts and a deployable Printer skeleton

This map records which product and architectural boundaries the accepted requirements touch. It
does not prescribe implementation.

## Scope summary

The increment delivers the first real path: a caller submits one job to the SQS queue and gets
one result on an SQS callback, on infrastructure created by Terraform and released through
GitHub OIDC. Template rendering is represented by a deterministic placeholder behind the
renderer boundary; real Chromium rendering and PDF/A arrive in the next increment.

## Affected boundaries

| Boundary | What changes | Consumers |
|---|---|---|
| Job ingress | The jobs queue becomes the only entry point; sender policy and DLQ behaviour apply | Caller teams, operators |
| Job/result contract | Job and result schemas become the public interface; error payloads follow the documented codes | Caller teams, workers, tests |
| Print processing | A use case validates, resolves a placeholder template identity, produces a PDF, and returns a result | Worker adapter, smoke test, local runner |
| Print storage | The prints bucket stores transient PDFs with encryption, blocked public access and one-day expiry | Worker, callers via short-lived link |
| Result delivery | The SQS callback path delivers success and failure results; other channels are out of scope | Caller teams, smoke test |
| Configuration and security | Queue senders, callback targets, allowlist settings and worker permissions are bounded | Operators, security review |
| Infrastructure | Bootstrap and the printer module become the only provisioning path | Operators, CI/CD |
| Release pipeline | Conventional Commits, semantic-release, OIDC deploy, smoke test and rollback become the release path | Operators, reviewers |
| Local development | LocalStack reproduces queue, storage and callback behaviour for developers | Developers, agents |
| Repository flow | `main` stays the integration target; prompt branches are short-lived and disposable | Reviewers, operators |

## Requirement impact map

| Requirement | Affected boundary | Acceptance evidence |
|---|---|---|
| R-001 | Job ingress, result delivery | One job yields one success or failure result; `refId` is echoed |
| R-002 | Job/result contract | Schema tests accept valid fixtures and reject invalid ones |
| R-003 | Print processing, print storage, result delivery | Deployed worker stores a PDF and returns a success result |
| R-004 | Release pipeline | Release and non-release commits deploy through OIDC |
| R-005 | Infrastructure | Bootstrap and printer module apply cleanly |
| R-006 | Contract, CI, infrastructure | Pull-request checks cover code, contracts, templates and Terraform |
| R-007 | Local development | LocalStack job completes and is visible in the sink |
| R-008 | Job ingress, result delivery | Retry, DLQ and last-attempt failure paths are demonstrated |
| R-009 | Print storage | Lifecycle expiry and presigned TTL are configured and tested |
| R-010 | Repository flow, CI | Commitlint and squash/linear history are enforced |
| R-011 | Security, job ingress, result delivery | Only allowed senders enqueue; only allowed targets receive |
| R-012 | Release pipeline, print processing | Deployed smoke passes; rollback deploys an earlier release |

## Not affected in this increment

- Template authoring tools, real template content and manifest publication — Phase 2.
- Chromium rendering, PDF/A post-processing and render regression — Phase 3.
- `http`, `lambda`, `eventBridge` and `s3` result channels, ping delivery and full HTTP allowlist
  enforcement — Phase 3.
- Load testing, production alarms, the full runbook and the multi-template smoke matrix — Phase
  3–4.
- Any API, UI, database, environment, template editor, runtime upload or template versioning —
  permanently out of scope.

## Boundary risks

- The placeholder renderer crosses the same renderer boundary as Chromium, so replacing it must
  not change the use case or contracts.
- The SQS-only delivery adapter must fail explicitly for other contract channels rather than
  silently accepting them.
- The local stack must not become a second implementation; the same worker code runs locally and
  in Lambda.
