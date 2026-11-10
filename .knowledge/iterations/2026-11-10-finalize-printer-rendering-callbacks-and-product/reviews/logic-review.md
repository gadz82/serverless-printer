# Logic review — final rendering, callbacks and production readiness

- Iteration: `2026-11-10-finalize-printer-rendering-callbacks-and-product`
- Integration target: `main` at `87485984bfa5`
- Review date: 2026-11-10
- Reviewers: PM/QE logic review with the per-prompt CR evidence; independent reviewers for every
  build prompt
- Scope: all 11 prompts (P-201 through P-211), Slices 2+3

## Verdict

**Recommend G6 approval.** The integrated behaviour satisfies the PRD, Gherkin scenarios and
blocking steering rules. No blocking finding is open. The only outstanding items are operator
actions that cannot be completed in the repository: the first real AWS deployment, the live
plain/PDF-A smoke and rollback, branch protection/release-bot bypass, the SNS alarm test and the
load/Power Tuning measurement that confirms the candidate target. They are documented in
[`docs/cloud-verification.md`](../docs/cloud-verification.md) and are not evidence of missing code.

G6 remains a human gate; this artifact does not pass it.

## Integrated evidence

| Check | Result | Commit |
| --- | --- | --- |
| `pnpm test` | 38 files, 614 tests passed | `87485984bfa5` |
| `pnpm typecheck` | all workspace projects passed | `87485984bfa5` |
| `pnpm lint` | passed, including the domain boundary rule | `87485984bfa5` |
| `pnpm exec prettier --check .` | passed | `87485984bfa5` |
| `pnpm template:validate` | 2 templates, 0 failures, 0 warnings | `87485984bfa5` |
| `pnpm build:worker` | 73,645,853-byte zip, 331 entries, 19 Chromium runtime packages | `87485984bfa5` |
| `RENDER_REGRESSION_REQUIRED=1 pnpm test:render` (Ubuntu 24.04 x86_64) | 10/10 passed, including the deliberate-change failure | `87485984bfa5` |
| `terraform -chdir=infra fmt/validate/tflint` | passed | `87485984bfa5` |
| `terraform -chdir=infra/bootstrap fmt/validate` | passed | `87485984bfa5` |
| `orchid-sdd lint` / `index --check` | 30 anchors, 30 docblocks, 180 nodes; projection current | `87485984bfa5` |
| Cross-repo dependencies | 0 rows; workspace disabled | `87485984bfa5` |
| Prompt branches/worktrees | none remain | `87485984bfa5` |

## Requirement traceability

| Requirement | Evidence |
| --- | --- |
| R-201 Chromium renders real templates on Lambda | `ChromiumPdfRenderer` + `TemplatePdfRenderer`; renderer/page-settings tests; Linux plain reference render |
| R-202 All eight PDF/A levels with ICC/XMP/safety | `PdfLibPdfArchiver` + `pdfa-archiver.test.ts` (37 domain + 20 archiver cases); PDF/A reference with `pdfaid:part=2`, `conformance=B`, `GTS_PDFA1` |
| R-203 Five channels and ping | `delivery-*` tests, router/composition tests, local integration 6/6 |
| R-204 Allowlist and SSRF | `CallbackPolicy` 55 tests; pinned HTTP/S3 transports; metadata/link-local/loopback rejection |
| R-205 Render regression | `tests/render` 10/10 on Linux; plain + PDF/A references; deliberate-change failure |
| R-206 Throughput target and Power Tuning | `scripts/load-test.mjs`, `docs/load-test.md`, 20-page target enforcement; live measurement is operator evidence |
| R-207 Alarms and runbook | `alarms.tf`, `docs/runbook.md`, alarm/SNS guidance; live SNS test is operator evidence |
| R-208 Plain and PDF/A smoke | `smoke-test.mjs` sends both scenarios and validates release/template/pdfA/hash/size; live run is operator evidence |
| R-209 Bootstrap/OIDC/branch protection/rollback | `docs/cloud-verification.md`, release workflow, bootstrap README; live verification is operator evidence |
| R-210 Bootstrap EC2/VPC permissions | bootstrap IAM, static plans and negative checks |
| R-211 Local Chrome file restriction | local Chrome tests, realpath/symlink containment |
| R-212 Created or provided worker role | Terraform role matrix, plans for create/existing modes |
| R-213 PassRole/GetRole for provided worker | bootstrap `additional_worker_role_arns`; plan/precondition evidence |
| R-214 Worker channel permissions | scoped `lambda:InvokeFunction`, `events:PutEvents`, `sqs:SendMessage`; no jobs send |
| R-215 Created or provided caller role | role matrix, queue senders, outputs |
| R-216 Caller/worker separation | separate role resources and policies; shared-role plan rejected |
| R-217 Provided caller added without IAM mutation | queue policy path; existing-mode plan |
| R-218 Caller trust principals | generated trust policy + validation |

## Gherkin verification

### Rendering

- A real `generic-report` render produces valid PDF text; JavaScript is disabled and external
  requests are blocked (`renderer-chromium.test.ts`, `renderer-local-chrome.test.ts`).
- Browser reuse, crash/target-closed relaunch, bounded page/browser close and the 50 s deadline
  are covered by the fakes and real local-Chrome tests.
- A4, print background, CSS page size, tagged output and page-number headers/footers are shared by
  the Lambda and local renderers (`renderer-page-settings.test.ts`).
- The Linux plain reference and the deliberate template change prove the regression detects
  page/text/appearance drift.

### PDF/A

- Every level is produced with the expected header, XMP part/conformance, sRGB output intent and
  Info metadata; Creator/CreatorTool are consistent (`pdfa-archiver.test.ts`).
- Encryption, JavaScript, unembedded Type0/Type1 and Type3 fonts fail with
  `PDFA_CONVERSION_FAILED`; the use case delivers a failure instead of a PDF/A result.
- No validator is claimed; the reference marker check only proves the archiver ran.

### Delivery and callbacks

- HTTP uses the print-id header, 5 s timeout, 2xx success, allowlist/SSRF validation, pinned
  addresses, no redirects and ping (`delivery-http.test.ts`, `callback-policy.test.ts`).
- Lambda, EventBridge and S3 deliver their documented payloads; S3 uploads PDF bytes and omits
  `printing`/`printingExpiresAt`; SQS keeps FIFO identifiers and ping.
- `CallbackNotAllowed` is preserved through the use case; invalid-message failure webhooks support
  HTTP/Lambda/SQS/EventBridge and reject S3.
- LocalStack integration is 6/6 (S3 channel unit-tested only because LocalStack presigns HTTP).

### Production readiness

- Packaging contains Chromium, the 19-package closure, templates, manifest and ICC; the unzipped
  payload is 83.6 MB, below the Lambda limit.
- Roles, bootstrap permissions, VPC modes, alarms/runbook, load/Power Tuning and the cloud
  checklist are implemented/documented; the live deployment, smoke, rollback, alarm test and
  target confirmation remain operator evidence.

## Findings

No blocking findings.

Non-blocking residuals to carry into the handover:

1. **Operator-only cloud evidence.** No real AWS apply, plain/PDF-A smoke, rollback, branch
   protection or SNS alarm test was run. The checklist is the reproduction path.
2. **Candidate target unconfirmed.** 10 20-page jobs/min and p95 < 30 s remain a candidate; the
   first load/Power Tuning run must confirm or revise it.
3. **Packaging is release-time validated.** `ci.yml` runs tests and the render regression but not
   `build:worker`; a packaging regression is caught by the release job.
4. **PDF/A is best effort.** No validator; part-1/a transparency/accessibility and other edge
   cases remain best-effort by design.
5. **Stale local-preview message.** `scripts/template-preview.mjs` still says PDF/A is "available
   in Slice 2" when `--pdfa` is passed. The README correctly says local PDF/A preview is
   unavailable. This is a low-severity wording cleanup outside the P-211 no-code scope.
6. **Branch protection state is external.** The required checks and release-bot bypass are
   documented; the actual ruleset must be configured and verified with a real `main` push.

## Recommendation

Approve the integrated changes and move forward to closure/handover, with the operator-only cloud
verification and target confirmation recorded as handover tasks. Do not mark the cloud items as
passed until the checklist evidence exists.
