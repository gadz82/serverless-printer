# Discovery impact — Complete the Printer service

## Affected boundaries

| Boundary | Change | Requirements |
|---|---|---|
| Template engine | New `packages/template-engine`: Handlebars modes, helpers, placeholder AST, hashing, manifest | R-101, R-102 |
| Template tooling | `template:new`, `validate`, `check`, `preview`, `manifest`; sample template | R-103, R-104, R-105 |
| Rendering | Chromium adapter, page settings, request interception, browser reuse | R-107 |
| PDF/A | New archiver port and pdf-lib adapter for all eight levels | R-108 |
| Delivery | Four new channels, ping, FIFO reuse, channel-specific failure handling | R-109 |
| Callback security | HTTP allowlist, DNS/SSRF, link-local/metadata blocking | R-110 |
| Network | `modules/network`, `vpc_mode` create/lookup, endpoints, NAT, worker VPC config | R-106 |
| Testing | Render regression, PDF/A matrix, load test, plain/PDF-A smoke | R-111, R-112, R-114 |
| Operations | Opt-in alarms, runbook, DLQ redrive, template removal, rollback | R-113 |
| Cloud | Bootstrap/OIDC deploy, first release, branch protection, rollback evidence | R-115 |

## Requirement impact map

| Requirement | Components | Acceptance evidence |
|---|---|---|
| R-101 | template-engine, worker | Mode tests; render fixture per mode |
| R-102 | template-engine, manifest | AST placeholder tests; manifest fixture |
| R-103 | scripts, template-engine | CLI command tests and local preview |
| R-104 | templates, worker, release | Deployed render by id and slug, plain and PDF/A |
| R-105 | scripts, template-engine, CI | Validation/check failure tests |
| R-106 | network module, printer module | Terraform validate/plan; VPC mode tests |
| R-107 | worker adapter | Chromium render tests; request block test |
| R-108 | worker archiver | Level matrix and failure-path tests |
| R-109 | worker adapters | Channel contract tests; LocalStack/smoke where possible |
| R-110 | worker HTTP edge | Allowlist/SSRF unit tests |
| R-111 | CI, scripts | Reference PDF comparison |
| R-112 | infra, scripts | Load test and Power Tuning report |
| R-113 | infra, docs | Alarm config and runbook review |
| R-114 | release workflow, scripts | Deployed plain + PDF/A smoke |
| R-115 | bootstrap, release workflow, GitHub | OIDC deploy, rollback and protection evidence |

## Not affected

- No API, UI, database, environments or runtime template upload.
- No template versioning or statuses.
- No PDF/A validator; conformance stays best effort.
- Phase 1 contracts remain unless an additive change is required.

## Boundary risks

- Chromium/pdf-lib must stay behind ports; the domain and template engine stay framework-free.
- The channel adapters share one result shape; no channel-specific business logic leaks into the
  use case.
- The network module is optional; `vpc_mode = none` must remain the default and keep working.
