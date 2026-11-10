# P-210 implementation report

- Prompt: P-210 — Add the load test and Power Tuning harness
- Status: complete

## Delivered

- `scripts/load-test.mjs`: sends `LOAD_TEST_JOBS` (default 20, max 200) jobs cycling through
  1-page plain, 1-page PDF/A-2b, 20-page plain and 20-page PDF/A-2b with unique refIds and SQS
  success/failure callbacks; validates job/result contracts; waits up to 240 s by default;
  reports completed/sent, mixed throughput, 20-page throughput/p95/sample count, p50/p95/max
  latency, p50/p95/max `Max Memory Used` (via optional AWS CLI log query), errors and SQS send
  failures; deletes matched results; exits non-zero on errors/timeouts; reports partial-batch
  send failures while still polling accepted jobs; enforces the 20-page 10 jobs/min and p95 <30 s
  candidate target only when `LOAD_TEST_ENFORCE_TARGET=1`.
- `--print-event` emits a one-record SQS event for Power Tuning with
  `ApproximateReceiveCount=MAX_RECEIVE_COUNT` (default 5) so retryable failures surface as a
  failure callback; requires `CALLBACK_QUEUE_ARN`.
- `docs/load-test.md`: candidate target, matrix, operator IAM, smoke-queue retention limits,
  dedicated queue guidance, exact Power Tuning SAR/state-machine input, unqualified function ARN,
  `$LATEST` caveat, average-duration-vs-p95 distinction, `TF_VARS` apply path, concurrency
  inputs, safety/cost notes.
- Terraform `worker_memory_size` root/module input (default 1,536 MB, 128–10,240 validation) wired
  to the Lambda; `infra/main.tf`, tfvars example and infra README updated. No defaults changed.

## Harness matrix

| Scenario | Payload | `pdfA` | Pages |
| --- | --- | --- | --- |
| `1-page-plain` | 3 items | `false` | 1 |
| `1-page-pdfa` | 3 items | `PDF/A-2b` | 1 |
| `20-page-plain` | 450 items | `false` | ~20 |
| `20-page-pdfa` | 450 items | `PDF/A-2b` | ~20 |

## Acceptance

| Command | Result |
| --- | --- |
| `node --check scripts/load-test.mjs` | PASS |
| Prettier on script/docs/README | PASS |
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra validate` | PASS |
| `pnpm test` / typecheck / lint on main | PASS — 614 tests |
| Fake-SQS 4-job run | PASS — 4/4, 20-page metrics, exit 0 |
| Simulated failure result | PASS — errors reported, exit 1 |
| Fake AWS CLI memory query | PASS — p50/p95/max reported |
| `--print-event` | PASS — 7-segment function ARN doc, last-attempt receive count |
| Real AWS load/Power Tuning | Not run — operator step |

## Review

Two independent reviewers: initial pass/changes requested. Fixed 20-page-specific target metrics,
TF_VARS apply path, exact Power Tuning input/IAM/cost guidance, p95 distinction, partial-batch
tracking, 240 s default timeout/queue retention, empty-batch handling, required callback ARN and
last-attempt receive count, unqualified Power Tuning ARN, and infra docs. Final verdict PASS.

## Residual risks

- No real AWS run: target, Power Tuning and memory behavior remain operator-verified.
- The default 20 jobs gives only ten 20-page samples; use 100+ for target evidence.
- Shared smoke queue has five-minute retention; use a dedicated queue for long runs.
- Power Tuning tunes `$LATEST`; publish a new version/alias through Terraform after choosing memory.
- Load tests inject into the live queue and consume worker capacity; run off-peak.
