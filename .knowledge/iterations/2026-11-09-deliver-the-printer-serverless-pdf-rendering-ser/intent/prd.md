# PRD — Foundations: contracts and a deployable Printer skeleton

- Iteration: `2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser`
- Technical only: no
- Source: `SPEC.md` v0.4, especially §1–§4, §6–§8 and §11 kickoff Phase 0–1

## Problem

Application teams need to turn HTML/Handlebars templates into PDFs without running or
operating a rendering service. Today the project exists only as `SPEC.md`: there is no
repository structure, no job/result contract, no deployable worker, no infrastructure and no
release path. Without those foundations, no template can be rendered and no caller can rely
on a stable interface.

This first increment builds the smallest real, deployable slice: a caller can send one job to
the SQS queue and receive one result on an SQS callback, on a release cut and deployed by the
project's own pipeline.

## Users and personas

- **Caller teams** — applications that submit print jobs and consume results.
- **Template maintainers** — engineers who add or change templates through Git.
- **Operators** — engineers who deploy, roll back and investigate failures.
- **Project developers** — humans and agents building the service against this specification.

## Current behaviour

Only the specification exists. There is no GitHub repository content, no pnpm workspace, no
contract, no worker, no Terraform state/bootstrap, no CI/CD, and no local environment.

## Desired outcome

A new caller can send a valid job message to the deployed jobs queue and receive a successful
result for it on an SQS callback queue. The release that produced that behaviour was cut by
semantic-release and deployed from `main` through GitHub Actions OIDC, with every AWS resource
created by Terraform. The same path is reproducible locally with LocalStack, and pull requests
are checked for code quality, contract compatibility, infrastructure validity and commit
conventions.

The rendered output in this increment may be a deterministic placeholder PDF produced behind
the real renderer port; Chromium rendering and PDF/A post-processing are the next increment's
scope. This keeps the foundation honest while proving packaging, queueing, storage, delivery,
configuration and release mechanics end to end.

## Flows

### Primary flow — deployed success

1. A caller sends one job message to the jobs queue.
2. The worker validates the message and resolves the bundled `_smoke` template identity.
3. The worker produces a PDF and stores it in the prints bucket.
4. The worker delivers a success result to the caller's SQS callback queue and deletes the job.
5. A smoke test performs the same flow after every deploy and waits for the result.

### Failure flow

- An invalid message produces `INVALID_MESSAGE` when a failure callback can be read.
- An unknown template produces `TEMPLATE_NOT_FOUND`.
- A retryable processing failure is retried; after the last receive the worker sends the
  failure result and deletes the message, or leaves it for the DLQ when the callback cannot be
  delivered.

### Local flow

A developer starts LocalStack and the callback sink, runs the worker as plain Node, sends a
job, and observes the result in the sink. No AWS account is required.

### Release and rollback flow

A Conventional Commit on `main` triggers semantic-release. A release tags the commit, builds
the worker zip, uploads it to the artifacts bucket, applies Terraform with the computed
release, and runs the smoke test. Dispatching the release workflow with an earlier release
deploys that release again without rebuilding it.

## Business rules

- **One message, one print.** A job produces exactly one PDF result or one failure result.
- **The SQS jobs queue is the only entry point.** There is no API, UI, database, environment
  or human-facing endpoint.
- **A template is its folder.** Identity is an immutable UUID `id` and an immutable, unique
  `slug`; callers may use either in `templateId`.
- **No template versions or statuses.** Git history is the history.
- **The service never keeps prints.** Prints expire after one day and presigned links are
  short-lived.
- **Results echo `refId` unchanged** and carry a deterministic `printId` so callers can
  deduplicate at-least-once delivery.
- **Deduplication is the caller's responsibility**, keyed by `printId`.
- **PDF/A is a per-job option.** The contract carries the option and its allowed levels;
  producing PDF/A is delivered later in the rendering increment.
- **No static AWS credentials anywhere.** Deployment and planning use GitHub OIDC only.
- **Conventional Commits are mandatory**, and `main` accepts squash-merged pull requests only.
- **Callbacks are restricted.** Only configured callback targets and allowlisted HTTP hosts
  may receive results.

## Success metrics

- The post-deploy smoke job travels from the jobs queue to the worker and back to the SQS
  callback queue within 60 seconds.
- A pull request runs and passes install, lint, typecheck, unit tests, contract tests,
  integration tests against LocalStack, commitlint, `terraform fmt -check`, `terraform
  validate` and `tflint`.
- A developer can reproduce a successful job locally with one documented command sequence.
- The repository contains zero static AWS access keys; secret scanning passes.
- Contract tests cover every required job and result field, including error payloads.
- Re-dispatching the release workflow with an earlier release value deploys that release and
  passes the smoke test.
- A semantic-release cut updates the changelog and creates a GitHub Release.

## Non-goals

- Template tooling (`template:new`, `validate`, `check`, `preview`, `manifest`) and real
  template content — kickoff Phase 2.
- Chromium rendering, PDF/A post-processing, render regression and Power Tuning — kickoff
  Phase 3.
- The `http`, `lambda`, `eventBridge` and `s3` result channels, ping delivery and full
  allowlist enforcement — kickoff Phase 3. Only the SQS result channel is in this increment.
- Load testing, alarms, the runbook and the full smoke-test matrix — kickoff Phase 3–4, except
  the single SQS smoke path required by the Phase 1 exit criterion.
- Template editor/UI/API, runtime template upload, template versioning, environments, a
  database, third-party monitoring and PDF/A validation are permanently out of scope.

## Assumptions and risks

- **Assumption:** the GitHub repository owner/name, AWS account, region and remote will be
  supplied by the operator; the code and workflows parameterize them.
- **Assumption:** an administrator can run `bootstrap/` once before the first pipeline deploy.
- **Risk:** the placeholder renderer proves plumbing, not real PDF fidelity. Real rendering
  risk is carried into the next increment.
- **Risk:** LocalStack does not perfectly emulate SQS/S3/Lambda; deployed smoke remains the
  authority.
- **Risk:** OIDC trust, branch protection and the remote repository cannot be fully verified
  locally.
- **Risk:** the 4 KB Lambda environment limit constrains the callback allowlist; the design
  must keep it bounded.

## Open questions

- Repository owner/name, AWS account ID and region are operational prerequisites, not product
  decisions. They must be recorded before the first deploy and are not blocking this intent.
- Branch strategy is decided: no feature branch; development stays on `main`; the remote is
  added later by the operator.

No other blocking product questions are open.
