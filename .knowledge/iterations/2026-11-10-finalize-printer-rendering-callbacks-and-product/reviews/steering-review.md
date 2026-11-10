# Steering review — final iteration

- Iteration: `2026-11-10-finalize-printer-rendering-callbacks-and-product`
- Integration target: `main` at `87485984bfa5`
- Phase: logic_review
- Rule source: `orchid-sdd steering context --phase logic_review`
- Owner: PM logic review; architecture/style evidence delegated to the per-prompt reviewers and
  verified on the integrated branch

Every active rule has a verdict with current evidence. A blocking rule with a `finding` would stop
G6; none does.

| Rule | Authority | Verdict | Evidence |
| --- | --- | --- | --- |
| `architecture-boundaries` | blocking | satisfied | `packages/domain` stays framework-free; `ProcessPrintJob` depends on ports only; no `@aws-sdk/*`, `node:fs`, `node:http` or worker imports in the domain. `pnpm lint` enforces the boundary and passed at `87485984bfa5`. |
| `solid-principles` | advisory | satisfied | One responsibility per adapter (`ChromiumPdfRenderer`, `PdfLibPdfArchiver`, `CallbackPolicy`, channel adapters, `TemplatePdfRenderer`); narrow ports (`PdfRenderer`, `PdfArchiver`, `PdfDestination`, `ResultDelivery`); composition root wires them. |
| `dependency-inversion-container` | advisory | satisfied | Explicit `composeWorker` in `apps/render-worker/src/composition-root.ts`; dependencies are constructor-injected; tests replace ports with fakes rather than importing AWS. |
| `code-style` | blocking | satisfied | `pnpm lint`, `pnpm typecheck`, Prettier and `pnpm test` pass on the integrated branch; 30 anchors/docblocks with `orchid-sdd lint` 0 errors/0 warnings. |
| `code-examples` | blocking | satisfied | TypeScript port/adapter/composition patterns match the shipped examples; no custom container, no framework leakage; deviations none. |
| `repository-flow` | blocking | satisfied | 11 prompt branches were created from `main`, independently reviewed, squash-merged and removed; no `orchid/*` branch or worktree remains; G5 recorded. |
| `saga-pattern` | advisory | not applicable | A print job is one asynchronous pipeline (render → optional PDF/A → store/upload → deliver), not a multi-service business transaction. Retryable failures use SQS retry/DLQ; terminal failures deliver a failure result. No compensation step is required. |
| `logic-review-steering` | blocking | satisfied | This review applies every active rule with current evidence; `reviews/logic-review.md` records integrated acceptance, Gherkin traceability and open operator risks. |
| `architecture-hexagonal` | blocking | satisfied | Domain/use case at the centre; Chromium, pdf-lib, AWS SDK, HTTP and S3 sit behind ports in `apps/render-worker/src/{rendering,pdfa,delivery,security,adapters}`; the composition root is the only wiring point. |
| `code-style-typescript` | blocking | satisfied | `pnpm typecheck` passes all workspace projects; ESLint (including `@typescript-eslint`) passes; no implicit/unchecked `any` boundary was introduced; contracts are validated before domain mapping and after delivery. |
| `repository-trunk-based` | blocking | satisfied | Work stayed on short-lived prompt branches and merged to `main` with squash commits; no long-lived branch or prompt worktree remains. Branch protection/ruleset setup is documented in `docs/cloud-verification.md` and remains an operator action. |

## Integrated evidence

| Command | Result |
| --- | --- |
| `pnpm test` | 614 tests passed |
| `pnpm typecheck` | passed |
| `pnpm lint` | passed |
| `pnpm exec prettier --check .` | passed |
| `pnpm template:validate` | 2/2 templates |
| `pnpm build:worker` | 73,645,853-byte zip, 19 Chromium packages |
| `RENDER_REGRESSION_REQUIRED=1 pnpm test:render` (Linux x64) | 10/10 |
| `terraform -chdir=infra fmt/validate/tflint` | passed |
| `terraform -chdir=infra/bootstrap fmt/validate` | passed |
| `orchid-sdd lint` / `index --check` | 30 anchors/30 docblocks; projection current |
| `orchid-sdd dependencies check` | 0 rows, 0 errors |

## Waivers and residual risks

No blocking rule is waived. The following are operator/follow-up items, not steering findings:

- Live AWS release, plain/PDF-A smoke, rollback, branch protection and SNS alarm test.
- Confirmation of the candidate 10 20-page jobs/min and p95 < 30 s target after load/Power Tuning.
- Packaging is validated by the release build rather than PR CI.
- PDF/A remains best effort with no validator.
- The local `template-preview --pdfa` message still references Slice 2; a wording cleanup for a
  follow-up.

## G6 recommendation

The blocking steering rules are satisfied on the integrated branch. Recommend G6 approval, with
the operator-only cloud verification recorded as handover tasks. G6 is a human gate and is not
passed by this review.
