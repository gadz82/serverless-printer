# P-001 implementation report

- Prompt: P-001 — Create the pnpm workspace, shared toolchain and dependency catalog
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-001`
- Status: complete

## Delivered

- pnpm 10.34.9 workspace with `apps/*` and `packages/*`, a single dependency catalog and a
  generated lockfile.
- Strict TypeScript base, ESLint flat config (including the domain boundary rule), Prettier,
  EditorConfig and Vitest config that excludes integration tests from the default run.
- Commitlint config and executable husky `commit-msg` hook.
- Root scripts for lint, format, typecheck, unit, contract, integration, manifest, build, local
  setup, local worker, callback sink and both smoke paths.
- `.gitignore`, `.npmrc`, `.editorconfig` and a README covering the layout, commands,
  architecture boundaries and Phase 1 limits.

## Acceptance

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS |
| `pnpm exec prettier --check .` | PASS |
| `pnpm typecheck` | PASS (no workspace packages yet) |
| `pnpm test` | PASS (no test files; integration excluded) |
| `git diff --check` | PASS |

## Review

Independent reviewer verdict: LGTM, no blocking findings. Low findings fixed before merge:

1. Removed `rootDir`/`outDir` from the shared tsconfig so package configs can extend it safely.
2. Extended the domain boundary gate to reject dynamic `import("@aws-sdk/...")` and the other
   forbidden modules.
3. Excluded `tests/integration/**` from the default `pnpm test` so the pull-request quality job
   does not need LocalStack; `pnpm test:integration` still runs them explicitly.
4. Corrected the README dependency direction: the worker depends on both domain and contracts;
   the domain does not import contracts.

## Residual risks

- Later prompts that add `catalog:` references will regenerate `pnpm-lock.yaml`; the orchestrator
  integrates the regenerated lockfile after each wave.
- The boundary gate covers static and dynamic imports; it is not a runtime sandbox.
