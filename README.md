# Printer

Printer turns HTML/Handlebars templates into PDFs asynchronously. Callers enqueue a job on SQS;
the render worker produces one PDF, stores it briefly in S3 and delivers the result through a
callback channel. The service never keeps prints.

This repository is the single deployment for the project. It has no environments, API, UI or
database: the jobs queue is the only entry point.

## Requirements

- Node.js `>=24`
- pnpm `10.34.9` (`corepack enable` or install it globally)

## Workspace layout

```
.
├── apps/
│   └── render-worker/     # SQS adapter, composition root and AWS adapters
├── packages/
│   ├── contracts/          # job/result JSON Schemas and generated types
│   ├── domain/             # entities, ports and use cases; no AWS imports
│   └── template-engine/    # Handlebars modes, helpers and manifest
├── templates/             # static HTML/Handlebars templates
├── scripts/               # template, build, local and smoke tooling
├── tests/
│   └── integration/       # LocalStack SQS/S3 integration tests
├── infra/                 # Terraform bootstrap, module and root deployment
├── .github/workflows/     # CI and release workflows
├── .husky/commit-msg      # local Conventional Commits check
├── pnpm-workspace.yaml    # workspace globs and the single dependency catalog
└── package.json           # root scripts; private, never published
```

## Commands

Install once from the repository root:

```bash
pnpm install --frozen-lockfile
```

| Command                        | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `pnpm lint`                    | ESLint over the workspace, including the domain boundary rule |
| `pnpm format:check`            | Prettier check (use `pnpm exec prettier --write .` to fix)    |
| `pnpm typecheck`               | Type-check every workspace package that defines `typecheck`   |
| `pnpm test`                    | Unit tests in `packages/**`, `apps/**` and `scripts/**`       |
| `pnpm test:contract`           | Contract package tests                                        |
| `pnpm test:integration`        | LocalStack integration tests under `tests/integration`        |
| `pnpm template:new <slug>`     | Create a template folder from the starter files               |
| `pnpm template:validate`       | Validate descriptors, HTML, samples and font usage            |
| `pnpm template:check`          | Compare template identities with a Git base ref               |
| `pnpm template:preview <slug>` | Render a template to PDF with a locally installed Chrome      |
| `pnpm template:manifest`       | Generate `templates.manifest.json` for the current `RELEASE`  |
| `pnpm build:worker`            | Bundle the worker, templates and manifest into `dist/`        |
| `pnpm local:setup`             | Create LocalStack queues and the local prints bucket          |
| `pnpm worker:local`            | Run the worker as plain Node against LocalStack               |
| `pnpm sink:local`              | Record callback results from the local SQS results queue      |
| `pnpm smoke:local`             | Send a local `_smoke` job and wait for its result             |
| `pnpm smoke:test`              | Send the deployed `_smoke` job used by the release workflow   |

## Templates

Templates live in `templates/<slug>/`. The bundled `generic-report` template is a neutral
business report with customer details, line items, formatted currency and dates, and a total. Use
it as the reference for a new template and preview it with:

```bash
pnpm template:preview generic-report
```

A template folder contains `template.json` (a stable UUID v4 `id`, a slug equal to the folder name,
`name` and `description`), the Handlebars source (`index.html` or another `.html`/`.hbs` file),
optional print CSS, and `sample.json` with the data used for validation and preview. Optional fonts
belong in `fonts/`; named font families that are neither bundled nor CSS generic families or
system-UI aliases produce validation warnings.

The template workflow is:

```bash
pnpm template:new invoice
pnpm template:validate
pnpm template:check --base origin/main
pnpm template:preview invoice
pnpm template:manifest
```

- `template:new <slug>` creates `templates/<slug>/` with `template.json`, `index.html`,
  `styles.css` and `sample.json`, and prints the new id. It refuses an existing folder and the
  reserved `_smoke` slug.
- `template:validate` compiles every template's HTML, validates each descriptor and `sample.json`,
  renders the sample in `assume-objects` mode, checks id/slug uniqueness and warns about fonts. CI
  runs it on every pull request.
- `template:check` needs Git history. It compares template identities against `--base` (default
  `HEAD`) and rejects changed ids or slugs, moved folders and slug reuse; it also reports new and
  removed templates. CI compares against `origin/main`.
- `template:preview <slug>` requires a locally installed Google Chrome or Chromium; set
  `CHROME_PATH` when it is not in a default location. It renders `sample.json` or `--data <file>`
  with the same A4 page settings the Slice 2 Lambda renderer will use and writes
  `.local/<slug>.pdf`. `--strict` requires every referenced value to be present. `--pdfa` is
  rejected until Slice 2.
- `template:manifest` writes `templates.manifest.json` for `RELEASE` (or `local`) with sorted
  entries and SHA-256 content hashes; `pnpm build:worker` bundles that manifest into `dist/`.

Templates use the fixed helpers `eq`, `formatCurrency` and `formatDate`, and the `each`, `if`,
`unless` and `with` control-flow blocks. Custom helpers, partials and decorators are rejected;
compilation supports the `lenient` (default), `strict` and `assume-objects` modes.

## Network

The optional Terraform network module is selected with `vpc_mode`:

| `vpc_mode` | Behaviour                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`     | Default. The worker runs outside a VPC; no subnets, NAT gateway or VPC endpoints are created.                                                                                                                                                                |
| `create`   | Creates a VPC (`vpc_cidr`, `az_count`), private subnets and S3/SQS/Lambda/Events endpoints. `enable_nat_gateway = true` adds public subnets, an internet gateway and one NAT gateway.                                                                        |
| `lookup`   | Attaches the worker to an existing VPC and subnets resolved by `vpc_id` or `vpc_tags` and `subnet_ids` or `subnet_tags`; it creates no VPC. Supply `worker_security_group_ids` to reuse existing egress groups, otherwise a managed worker group is created. |

`lookup` requires exactly one of `vpc_id`/`vpc_tags` and exactly one of `subnet_ids`/`subnet_tags`.
In `create` and `lookup` modes the worker Lambda receives a `vpc_config`; in `none` it has none.
See [`infra/README.md`](infra/README.md#network) for endpoint/NAT trade-offs, examples and the
permissions each mode requires.

## Dependency catalog

Every runtime and development dependency is declared once in the `catalog` section of
`pnpm-workspace.yaml`. Workspace packages reference entries with `catalog:` and never pin a
version themselves:

```json
{
  "dependencies": {
    "@aws-sdk/client-sqs": "catalog:"
  }
}
```

`pnpm-lock.yaml` is the only lockfile and is generated from that catalog. Adding a dependency
outside the catalog requires an ADR and a change to `pnpm-workspace.yaml`.

## Architecture boundaries

The dependency direction is:

```
apps/render-worker -> packages/domain
apps/render-worker -> packages/contracts
packages/domain      (no project-package imports)
packages/contracts   (no project-package imports)
```

- `packages/domain` contains entities, errors, ports and the `ProcessPrintJob` use case. It must
  not import `@aws-sdk/*`, `aws-lambda`, `node:fs`, `node:http`, `node:https` or the worker
  adapter, and it does not import `packages/contracts`: the worker maps transport contracts to
  domain types at the adapter boundary. ESLint fails the build if the boundary is crossed.
- `packages/contracts` owns the JSON Schemas, generated TypeScript types and Ajv validation. It
  is framework-free and is the public contract for job and result messages.
- `apps/render-worker` owns the Lambda handler, configuration, manifest catalog, AWS SDK clients
  and delivery adapters. It wires the use case exactly once in its composition root.
- `scripts/` provides build and local tooling. It may import application packages, never the
  other way around.
- `infra/` and `.github/workflows/` do not import application code.

The renderer, storage and delivery implementations sit behind ports, so the Slice 2
Chromium/PDF-A engine can replace the Slice 1 placeholder without changing the use case or the
public contract.

## Slice 1 scope

Slice 1 proves the real queue -> worker -> storage -> callback path and adds the template tooling,
not production rendering:

- The PDF renderer is a deterministic, dependency-free **placeholder** behind the `PdfRenderer`
  port. It returns a minimal valid PDF and ignores the template and payload. It is not evidence
  of rendering fidelity, font embedding or PDF/A conformance.
- Only the **`sqs`** result channel is implemented. Jobs that request `http`, `lambda`,
  `eventBridge` or `s3` fail non-retryably with `CALLBACK_NOT_ALLOWED`; the contract still models
  all five channels.
- **PDF/A is rejected.** `PDFA_ALLOWED_LEVELS` defaults to an empty list, so any `options.pdfA`
  request fails non-retryably with `PDFA_LEVEL_NOT_ALLOWED`. A PDF is never labelled as PDF/A
  when no conversion ran.
- The bundled `_smoke` and `generic-report` template identities are resolved through the manifest
  so their paths match the future renderer.
- `template:validate` and `template:check` run in CI, and `template:preview` renders through a
  locally installed Chrome. The Lambda package still has no Chromium.

## Slice roadmap

- **Slice 2:** Chromium Lambda rendering, PDF/A output and all callback channels (`http`, `lambda`,
  `eventBridge`, `s3`).
- **Slice 3:** capacity and load testing, operational alarms and runbook, and cloud verification.

## Local verification

Local development runs the same worker code as plain Node against LocalStack. Docker Compose
starts LocalStack (SQS and S3) and a callback sink; the worker still uses the placeholder renderer
until Chromium Lambda rendering arrives in Slice 2.

```bash
pnpm install
docker compose up -d localstack
pnpm local:setup
pnpm worker:local   # terminal 1
pnpm sink:local     # terminal 2
pnpm smoke:local    # terminal 3
```

The sink appends one JSON line per result to `.local/results.jsonl`. LocalStack and the sink are
development-only; they never replace the deployed smoke test.

## Cloud verification

The release path is authoritative:

1. CI validates lint, formatting, types, unit, contract, templates, LocalStack integration and
   Terraform.
2. A push to `main` lets semantic-release compute a SemVer tag (or a `sha-<short>` release),
   builds the worker zip, uploads it to the artifacts bucket and applies Terraform through
   GitHub OIDC. There are no static AWS keys. The workflow requires the repository variables
   documented in [`infra/README.md`](infra/README.md#release-workflow-configuration), including
   `TF_VARS` for the non-secret operator configuration.
3. The release workflow sends a `_smoke` job to the deployed queue and waits for the SQS
   callback. A successful smoke proves the deployed queue, worker, S3 storage and callback path.

A manual `workflow_dispatch` with an earlier release applies that release and re-runs the smoke
test, which is the rollback path.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The
`.husky/commit-msg` hook runs commitlint locally, and CI checks every commit in a pull request
plus the pull request title. `main` is trunk-based: short-lived branches, squash merge, linear
history.

## License

Private and unpublished. All rights reserved.
