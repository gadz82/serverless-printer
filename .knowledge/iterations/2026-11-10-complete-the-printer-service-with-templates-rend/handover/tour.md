# Tour — Slice 1: templates and network

A 12-stop reading order. Every command works from the repository root after
`pnpm install --frozen-lockfile`.

1. `packages/template-engine/src/compile-template.ts#compileTemplate` — ORCHID-MEM:
   `01a1c51f-3f91-786a-b869-f8fc6cc335f4`
   - Why: one Handlebars contract for worker, validation and preview.
   - Prove it: `pnpm --filter @printer/template-engine test`
2. `packages/template-engine/src/extract-placeholders.ts#extractPlaceholders` — ORCHID-MEM:
   `01a1c51f-4010-7adb-9a80-cc229f720c94`
   - Why: the manifest and sample validation need one safe data shape.
   - Prove it: `pnpm --filter @printer/template-engine test`
3. `packages/template-engine/src/build-manifest.ts#buildManifest` — ORCHID-MEM:
   `01a1c51f-4088-78ce-b103-197da857f991`
   - Why: deterministic hashes and compiled templates go into the bundle.
   - Prove it: `pnpm --filter @printer/template-engine test`
4. `apps/render-worker/src/rendering/local-chrome-renderer.ts#LocalChromeRenderer` — ORCHID-MEM:
   `01a1c51f-4103-7564-a29a-ff3468f66402`
   - Why: preview uses the same page settings and security posture as Slice 2.
   - Prove it: `pnpm --filter @printer/render-worker test`
5. `scripts/template-validate.mjs#validateTemplates` — ORCHID-MEM:
   `01a1c51f-4183-76ad-b5fd-a13d1ce22f96`
   - Why: broken identity, compilation or sample data must fail before deploy.
   - Prove it: `pnpm template:validate`
6. `scripts/template-check.mjs#checkTemplates` — ORCHID-MEM:
   `01a1c51f-4207-7ab3-ac69-281c356e1ffe`
   - Why: public template identity is immutable; Git history is the version history.
   - Prove it: `pnpm template:check --base HEAD`
7. `scripts/template-preview.mjs#previewTemplate` — ORCHID-MEM:
   `01a1c51f-4289-7e73-8075-584669d85127`
   - Why: maintainers can see the real layout without deploying.
   - Prove it: `pnpm template:preview generic-report`
8. `templates/generic-report/index.html` — the first real generic business template.
   - Why: it exercises Handlebars, helpers, sample data and local Chrome end to end.
   - Prove it: `pnpm template:validate && pnpm template:preview generic-report`
9. `infra/modules/network/main.tf` — optional VPC `none`/`create`/`lookup`.
   - Why: private HTTP callbacks without forcing a VPC by default.
   - Prove it: `terraform -chdir=infra init -backend=false -input=false && terraform -chdir=infra validate`
10. `infra/modules/printer/lambda.tf` and `iam.tf` — conditional VPC config and ENI IAM.
    - Why: the worker attaches only when asked, with the permissions Lambda VPC needs.
    - Prove it: the network plans in `infra/README.md`
11. `.github/workflows/ci.yml` — the `templates` job.
    - Why: validation and identity checks run on every pull request.
    - Prove it: `pnpm template:validate && pnpm template:check --base HEAD`
12. `README.md` and `infra/README.md` — commands, modes and the Slice 2/3 roadmap.
    - Why: the operator and template maintainer runbook.
    - Prove it: `pnpm exec prettier --check README.md infra/README.md`

## Suggested path

Start at the engine (stops 1–3), follow the CLI (4–7), open the real template (8), then the network
(9–10), CI (11) and docs (12). Failure paths are in the engine/CLI tests; Slice 2/3 scope is in
`release-notes.md` and ADR-107.
