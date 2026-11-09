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
│   └── template-engine/    # Handlebars modes, helpers and manifest (Phase 2)
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

| Command                  | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm lint`              | ESLint over the workspace, including the domain boundary rule |
| `pnpm format:check`      | Prettier check (use `pnpm exec prettier --write .` to fix)    |
| `pnpm typecheck`         | Type-check every workspace package that defines `typecheck`   |
| `pnpm test`              | Unit tests in `packages/**`, `apps/**` and `scripts/**`       |
| `pnpm test:contract`     | Contract package tests                                        |
| `pnpm test:integration`  | LocalStack integration tests under `tests/integration`        |
| `pnpm template:manifest` | Generate `templates.manifest.json` for the current `RELEASE`  |
| `pnpm build:worker`      | Bundle the worker, templates and manifest into `dist/`        |
| `pnpm local:setup`       | Create LocalStack queues and the local prints bucket          |
| `pnpm worker:local`      | Run the worker as plain Node against LocalStack               |
| `pnpm sink:local`        | Record callback results from the local SQS results queue      |
| `pnpm smoke:local`       | Send a local `_smoke` job and wait for its result             |
| `pnpm smoke:test`        | Send the deployed `_smoke` job used by the release workflow   |

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

The renderer, storage and delivery implementations sit behind ports, so the production
Chromium/PDF-A engine can replace the Phase 1 placeholder without changing the use case or the
public contract.

## Phase 1 scope

Phase 1 proves the real queue -> worker -> storage -> callback path, not production rendering:

- The PDF renderer is a deterministic, dependency-free **placeholder** behind the `PdfRenderer`
  port. It returns a minimal valid PDF and ignores the template and payload. It is not evidence
  of rendering fidelity, font embedding or PDF/A conformance.
- Only the **`sqs`** result channel is implemented. Jobs that request `http`, `lambda`,
  `eventBridge` or `s3` fail non-retryably with `CALLBACK_NOT_ALLOWED`; the contract still models
  all five channels for later phases.
- **PDF/A is rejected.** `PDFA_ALLOWED_LEVELS` defaults to an empty list, so any `options.pdfA`
  request fails non-retryably with `PDFA_LEVEL_NOT_ALLOWED`. A PDF is never labelled as PDF/A
  when no conversion ran.
- The bundled `_smoke` template identity is resolved through the manifest so the path matches
  the future renderer.
- Chromium, PDF libraries and the production renderer arrive in Phase 3 behind the same port.

## Local verification

Local development runs the same worker code as plain Node against LocalStack. Docker Compose
starts LocalStack (SQS and S3) and a callback sink; the worker uses an installed Chrome only when
the real renderer arrives in Phase 3.

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

1. CI validates lint, formatting, types, unit, contract, LocalStack integration and Terraform.
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
