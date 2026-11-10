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
│   ├── integration/       # LocalStack SQS/S3 integration tests
│   └── render/            # Chromium plain/PDF-A regression and references
├── docs/                  # runbook, cloud verification and load test guides
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

| Command                        | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm lint`                    | ESLint over the workspace, including the domain boundary rule                |
| `pnpm format:check`            | Prettier check (use `pnpm exec prettier --write .` to fix)                   |
| `pnpm typecheck`               | Type-check every workspace package that defines `typecheck`                  |
| `pnpm test`                    | Unit tests in `packages/**`, `apps/**` and `scripts/**`                      |
| `pnpm test:contract`           | Contract package tests                                                       |
| `pnpm test:integration`        | LocalStack integration tests under `tests/integration`                       |
| `pnpm test:render`             | Chromium plain/PDF-A render regression (Linux x86_64 + poppler)              |
| `pnpm template:new <slug>`     | Create a template folder from the starter files                              |
| `pnpm template:validate`       | Validate descriptors, HTML, samples and font usage                           |
| `pnpm template:check`          | Compare template identities with a Git base ref                              |
| `pnpm template:preview <slug>` | Render a template to PDF with a locally installed Chrome                     |
| `pnpm template:manifest`       | Generate `templates.manifest.json` for the current `RELEASE`                 |
| `pnpm build:worker`            | Bundle the worker, Chromium closure, templates and manifest into `dist/`     |
| `pnpm local:setup`             | Create LocalStack queues and the local prints bucket                         |
| `pnpm worker:local`            | Run the worker as plain Node against LocalStack                              |
| `pnpm sink:local`              | Record callback results from the local SQS results queue                     |
| `pnpm smoke:local`             | Send a local `_smoke` job and wait for its result                            |
| `pnpm smoke:test`              | Send the deployed plain and PDF/A `_smoke` jobs used by the release workflow |

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
  with the same A4 page settings the Lambda renderer uses and writes `.local/<slug>.pdf`.
  `--strict` requires every referenced value to be present. `--pdfa <level>` applies the same
  pdf-lib archiver as the worker and writes `.local/<slug>-pdfa.pdf`.
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

The renderer, storage, PDF/A and delivery implementations sit behind ports. The Lambda renderer
uses `puppeteer-core` with the pinned `@sparticuz/chromium`, and the same shared page settings and
request policy drive the local Chrome preview. The use case and public contract do not depend on
the adapter choice.

## Current scope

The repository now implements the full product contract:

- Chromium rendering of HTML/Handlebars templates in Lambda, with one launch per instance, a page
  per job, JavaScript disabled and request interception limited to bundled files/data URIs.
- PDF/A post-processing for all eight levels (`PDF/A-1b` through `PDF/A-3a`) with pdf-lib, an sRGB
  ICC output intent and best-effort conformance. No PDF/A validator is run.
- All five callback channels (`http`, `lambda`, `sqs`, `eventBridge`, `s3`), callback ping, and
  the callback allowlist/SSRF policy. S3 deliveries upload the PDF bytes rather than the JSON
  result.
- Separate generated-or-provided caller and worker roles, opt-in alarms, the operations runbook,
  the render regression, the load/Power Tuning harness and the cloud verification checklist.
- `template:validate`, `template:check` and the CI render regression protect template identities
  and rendering output.

The remaining work is operator verification of the first cloud deployment; see
[`docs/cloud-verification.md`](docs/cloud-verification.md).

## Local verification

Local development runs the same worker code as plain Node against LocalStack. Docker Compose
starts LocalStack (SQS and S3) and a callback sink; outside Lambda the composition root selects the
installed Chrome renderer, while the Lambda package uses `@sparticuz/chromium`.

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

1. CI validates lint, formatting, types, unit, contract, templates, LocalStack integration, the
   plain/PDF-A render regression, commit conventions and Terraform.
2. A push to `main` lets semantic-release compute a SemVer tag (or a `sha-<short>` release),
   builds the worker zip, uploads it to the artifacts bucket and applies Terraform through
   GitHub OIDC. There are no static AWS keys. The workflow requires the repository variables
   documented in [`infra/README.md`](infra/README.md#release-workflow-configuration), including
   `TF_VARS` for the non-secret operator configuration.
3. The release workflow sends a plain and a `PDF/A-2b` `_smoke` job to the deployed queue and
   waits for both SQS callbacks. Successful smokes prove the deployed queue, Chromium worker,
   PDF/A archiver, S3 storage and callback path.

A manual `workflow_dispatch` with an earlier release applies that release and re-runs both smoke
jobs, which is the rollback path. The full first-deployment checklist, role-mode prerequisites,
branch-protection bypass, VPC checks, alarm test and throughput evidence are in
[`docs/cloud-verification.md`](docs/cloud-verification.md); use
[`docs/runbook.md`](docs/runbook.md) for incidents and [`docs/load-test.md`](docs/load-test.md)
for capacity measurements.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The
`.husky/commit-msg` hook runs commitlint locally, and CI checks every commit in a pull request
plus the pull request title. `main` is trunk-based: short-lived branches, squash merge, linear
history.

## License

Private and unpublished. All rights reserved.
