# Logic review — Slice 1: templates and network

- Iteration: `2026-11-10-complete-the-printer-service-with-templates-rend`
- Approved scope: Slice 1 only (R-101–R-106), with Slices 2–3 as follow-up iterations (ADR-107)
- Verdict: **No code-level blocking finding. Deferred PDF/A preview, deployed real-template
  verification and VPC apply remain follow-ups and need human acceptance.**

## What was verified

- 411 tests pass, including 80 template-engine tests, 93 worker tests, 23 template-CLI tests,
  LocalStack integration and manifest drift.
- `pnpm lint`, `pnpm typecheck`, Prettier, `terraform validate`, `terraform fmt`, TFLint, template
  validate/check, `orchid-sdd lint` (19 anchors, 19 docblocks, 0 errors) and index checks pass.
- `template:new`, `validate`, `check`, `manifest` and `preview` work locally.
- `generic-report` renders through the shared engine and local Chrome with JS disabled, external
  requests blocked, A4/tagged output and page headers/footers.
- `vpc_mode` `none`, `create` and `lookup` plan successfully; `none` creates no network and no
  Lambda VPC config; worker ENI IAM is conditional.
- The manifest includes `_smoke` and `generic-report`; the worker drift test passes.

## Scenario walk — Slice 1

| Scenario | Verdict | Evidence |
|---|---|---|
| S-101 Lenient missing fields empty | Satisfied | Engine mode tests |
| S-102 Strict any missing field fails | Satisfied | Engine tests, including nested each/with and helper args |
| S-103 Assume-objects only parent objects fail | Satisfied | Engine tests |
| S-104 Only fixed helpers | Satisfied | Unknown helper/log/lookup/partial/decorator rejection tests |
| S-105 Manifest placeholder shapes | Satisfied | AST tests + manifest fixtures |
| S-106 Validation rejects identity/compile/sample errors | Satisfied | `template-validate` tests |
| S-107 Check blocks id/slug changes | Satisfied | Temporary Git-repo tests; folder moves explicitly rejected |
| S-108 template:new creates a valid template | Satisfied | CLI tests |
| S-109 Font warning does not fail | Satisfied | CLI tests |
| S-110 Preview renders sample or supplied data | **Partially satisfied** | `--strict`/`--data` and PDF output pass; `--pdfa` is explicitly deferred to Slice 2 |
| S-111 Real template by id and slug after deploy, plain and PDF/A | **Deferred** | `generic-report` renders locally; deploy and PDF/A are Slice 2/3 |
| S-112 vpc_mode none creates no network | Satisfied by plan | 20-resource plan, no VPC config/IAM |
| S-113 vpc_mode create attaches worker | Satisfied by plan | VPC/subnets/endpoints/optional NAT plan |
| S-114 vpc_mode lookup uses existing VPC | Satisfied by plan | ID/tag selector plans |

S-115–S-127 (Chromium Lambda, PDF/A, all channels, render regression, load, alarms, smoke, cloud)
belong to Slices 2–3 and are **not delivered in this iteration**. ADR-107 and the G3 approval
record that split.

## Business-rule check

- Handlebars is the template language; fixed helpers; modes; escaping; prototype access off.
- Template identity is UUID v4 + immutable slug; validation/check enforce uniqueness and guards.
- The manifest is deterministic and content-hashed; `_smoke` remains the release identity.
- `generic-report` is a real self-contained generic business report, not the spec's example name.
- No API/UI/database/environments/template upload/versioning.
- Network remains optional; `none` is the default and unchanged.
- No PDF/A claim in Slice 1; preview rejects `--pdfa` until the archiver exists.

## Findings and disposition

1. **PDF/A preview and deployed real-template verification are deferred (medium, accepted by
   staging).** S-110's `--pdfa` and S-111's deploy/PDF-A parts move to Slice 2/3.
2. **VPC modes are plan-only (medium).** No AWS apply; the bootstrap deploy role lacks EC2/VPC
   permissions, so an admin profile or a bootstrap follow-up is needed. `none` is unaffected.
3. **Local Chrome file allowlist is scheme-wide (low for Slice 1, medium for Lambda reuse).**
   Slice 2 must scope `file:` URLs to the template/bundle directory.
4. **Placeholder extraction flattens `../` depth (low).** The manifest stays coarse inside
   `each`/`with`; strict/assume runtime wrappers cover control/helper arguments.
5. **UUID-shaped slugs can collide with ids (low).** Cross-namespace uniqueness is a follow-up.
6. **Branch protection/CI have not run on GitHub (medium).** The remote exists; the operator must
   enable protection and the new templates check.
7. **Template check cannot detect an id+slug+folder change in one commit (low).** Run validate in
   CI as well; documented.

## Scope check

No scope creep. Slice 1 delivered the template engine, CLI, generic-report, local preview and
network module. Chromium Lambda packaging, PDF/A, non-SQS channels, render regression, load,
alarms, runbook and cloud verification remain the approved Slices 2–3.

## Recommendation

Close Slice 1 and record Slices 2–3 as the follow-up iterations, or keep the iteration open until
the full Phase 2–4 work is delivered. The human decides at G6.
