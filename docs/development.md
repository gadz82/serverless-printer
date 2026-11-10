# Development

## Workspace layout

```text
.
├── apps/render-worker/     # Lambda handler, composition root, AWS/Chromium/channel adapters
├── packages/
│   ├── contracts/          # job/result JSON Schemas, generated types and validation
│   ├── domain/             # entities, ports and use cases; no AWS imports
│   └── template-engine/    # Handlebars modes, helpers, placeholder tree and manifest
├── templates/              # static HTML/Handlebars templates and samples
├── scripts/                # template, build, local, smoke, regression and load tooling
├── tests/
│   ├── integration/        # LocalStack SQS/S3 integration tests
│   └── render/             # Chromium plain/PDF-A regression and references
├── docs/                   # product, architecture, usage and operations guides
├── infra/                  # Terraform bootstrap, optional network, printer module and root
├── .github/workflows/      # CI and release workflows
├── pnpm-workspace.yaml     # workspace globs and the single dependency catalog
└── package.json            # root scripts; private, never published
```

## Commands

Install from the repository root:

```bash
pnpm install --frozen-lockfile
```

| Command                        | Purpose                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `pnpm lint`                    | ESLint over the workspace, including the domain boundary rule                 |
| `pnpm format:check`            | Prettier check (`pnpm exec prettier --write .` fixes)                         |
| `pnpm typecheck`               | Type-check every workspace package                                            |
| `pnpm test`                    | Unit/contract tests (excludes LocalStack integration and render regression)   |
| `pnpm test:contract`           | Contract package tests                                                        |
| `pnpm test:integration`        | LocalStack integration under `tests/integration`                              |
| `pnpm test:render`             | Chromium plain/PDF-A reference comparison (Linux x86_64 + poppler)            |
| `pnpm template:new <slug>`     | Create a template folder                                                      |
| `pnpm template:validate`       | Validate descriptors, HTML, samples and fonts                                 |
| `pnpm template:check`          | Compare template identities with a Git base ref                               |
| `pnpm template:preview <slug>` | Render locally with installed Chrome; `--pdfa <level>` also works             |
| `pnpm template:manifest`       | Generate `templates.manifest.json`                                            |
| `pnpm build:worker`            | Bundle the worker, Chromium closure, templates, manifest and ICC into `dist/` |
| `pnpm local:setup`             | Create LocalStack queues and the local prints bucket                          |
| `pnpm worker:local`            | Run the worker as plain Node against LocalStack                               |
| `pnpm sink:local`              | Record callback results from the local SQS results queue                      |
| `pnpm smoke:local`             | Send a local `_smoke` job and wait for its result                             |
| `pnpm smoke:test`              | Send the deployed plain + PDF/A `_smoke` jobs used by the release workflow    |

## Local verification

Local development runs the same worker code as plain Node against LocalStack. Outside Lambda the
composition root selects the installed Chrome renderer; inside Lambda it uses
`@sparticuz/chromium`. The worker needs a local Chrome/Chromium or `CHROME_PATH`.

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

For a single template preview:

```bash
pnpm template:preview generic-report
pnpm template:preview generic-report --pdfa PDF/A-2b
```

## Test strategy

- **Unit/contract:** domain use case, Handlebars modes, placeholder extraction, manifest, channel
  adapters, callback policy, PDF/A archiver and renderer lifecycle.
- **LocalStack integration:** SQS → worker → S3/callback with the local Chrome renderer.
- **Render regression:** real Lambda Chromium on Linux x86_64, poppler page/text/image comparison
  against committed plain and PDF/A references; a deliberate template change must fail.
- **Smoke:** the release workflow sends plain and PDF/A-2b jobs and validates both callbacks.
- **Terraform:** fmt/validate/tflint plus module tests for the optional EventBridge ingress.

## Dependency catalog

Every runtime and development dependency is declared once in the `catalog` section of
`pnpm-workspace.yaml`. Workspace packages reference entries with `catalog:` and never pin a version
themselves:

```json
{ "dependencies": { "@aws-sdk/client-sqs": "catalog:" } }
```

`pnpm-lock.yaml` is the only lockfile. Adding a dependency outside the catalog requires an ADR and
a `pnpm-workspace.yaml` change.

## Architecture boundaries

```text
apps/render-worker -> packages/domain
apps/render-worker -> packages/contracts
packages/domain      (no project-package imports)
packages/contracts   (no project-package imports)
```

- `packages/domain` contains entities, errors, ports and `ProcessPrintJob`. It must not import
  `@aws-sdk/*`, `aws-lambda`, `node:fs`, `node:http`, `node:https` or worker adapters; ESLint fails
  the build if the boundary is crossed.
- `packages/contracts` owns the JSON Schemas, generated types and Ajv validation. It is the public
  contract for job and result messages.
- `apps/render-worker` owns the Lambda handler, config, manifest catalog, AWS SDK clients and
  delivery adapters, wired once in its composition root.
- `scripts/` provides build/local tooling and may import application packages, never the reverse.
- `infra/` and `.github/workflows/` do not import application code.

See [Architecture](architecture.md) for the runtime flow and ports/adapters.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The husky
`commit-msg` hook runs commitlint locally; CI checks every PR commit and the PR title. `main` is
trunk-based: short-lived branches, squash merge, linear history.

## Templates and release

Template authoring is in [Templates](templates.md). Release/deploy options are in
[Deployment](deployment.md); incident procedures are in the [Runbook](runbook.md).
