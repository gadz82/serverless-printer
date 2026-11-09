# Estimate

## Magnitude

| Dimension | Assessment |
|---|---|
| Scope | 12 requirements, 23 scenarios, 8–10 development prompts |
| Risk | 3/5 — OIDC, first Terraform apply and LocalStack parity are the uncertain parts; local code path is well understood |
| Reversibility | High — greenfield repository, no users, no persistent data |
| Effort | M–L, roughly 5–7 engineering days for one developer |
| Confidence | High for contracts/domain/worker locally; medium for cloud bootstrap/deploy until an account and remote exist |
| Blast radius | Low — new service; no existing consumers or data |

## Work breakdown

| Wave | Outcome | Prompts (indicative) |
|---|---|---|
| 1 | Workspace, contracts and generated types | 2 |
| 2 | Domain use case, ports, placeholder renderer, worker adapters | 3 |
| 3 | Terraform bootstrap, printer module, root deployment | 2 |
| 4 | CI, release workflow, LocalStack compose, smoke script, docs | 2–3 |

## Budget

- `per_iteration_warn`: 250,000 tokens; `per_iteration_stop`: 600,000.
- Estimated build consumption: 180,000–300,000 tokens with fresh-context reviewers. The warning
  is expected to be reached near the end; the plan will surface the cost at G4.
- Prompt estimates: S or M for most prompts; the Terraform and release prompts are M.

## Schedule assumptions

- The operator can provide the GitHub owner/repo and AWS account before the cloud verification
  prompt; otherwise that prompt's acceptance is deferred to the first real deploy.
- No external review latency is included.
- Chromium/PDF-A, template tooling and extra channels are excluded from this estimate.

## Cost of delay / alternatives

- Doing Chromium now would add Chromium packaging, platform pins and render regression, roughly
  doubling this increment and increasing cloud risk before the foundation is proven.
- Doing all channels now would add four delivery adapters, ping and allowlist enforcement, with
  little extra product value until the core path is stable.
