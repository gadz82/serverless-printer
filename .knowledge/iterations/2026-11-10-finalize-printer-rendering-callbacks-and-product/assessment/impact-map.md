# Assessment impact map

## Slice 2 — rendering, PDF/A, channels

| Area | Change | Requirements |
|---|---|---|
| Worker rendering | Shared page settings + `ChromiumPdfRenderer` with @sparticuz, browser reuse/crash recovery | R-201 |
| Worker PDF/A | `PdfArchiver` port + pdf-lib adapter, ICC/XMP/Info/checks | R-202 |
| Delivery | HTTP, Lambda, EventBridge, S3 adapters, ping, shared result shape | R-203 |
| Security | Callback allowlist, DNS/link-local/metadata SSRF, scoped IAM | R-204 |
| CI | Render regression for plain/PDF-A references | R-205 |
| Local preview | File-request scoping/hardening | R-211 |

## Slice 3 — production, roles, cloud

| Area | Change | Requirements |
|---|---|---|
| Capacity | Throughput confirmation, Power Tuning, load test | R-206 |
| Operations | Alarms, SNS, runbook, DLQ/template removal/rollback | R-207 |
| Release | Plain + PDF/A smoke, first real template live | R-208 |
| Cloud | Bootstrap/OIDC/rollback/branch protection | R-209 |
| Bootstrap | EC2/VPC permissions and `iam:PassRole` support | R-210, R-213 |
| Roles | Generated/provided caller and worker roles, outputs, queue policy, trust | R-212–R-218 |

## Ports and adapters

- `PdfRenderer` → Chromium (Lambda) / local Chrome (preview).
- `PdfArchiver` → pdf-lib.
- `ResultDelivery` → five adapters.
- `CallbackPolicy` → allowlist + DNS/SSRF.
- Terraform roles: caller (send jobs) and worker (consume/publish).

## Boundary checks

- Domain/template engine stay free of Chromium/pdf-lib/AWS.
- Channel payloads stay in adapters; caller/worker IAM stays separate.
- No API/UI/database/environments; no template upload/versioning.

## Risks by area

| Risk | Mitigation |
|---|---|
| Chromium package/zip/cold start | Pin major, render regression, load test |
| PDF/A conformance | Best-effort docs, safety checks |
| SSRF/allowlist | Shared policy + tests |
| Provided role trust/permissions | Same-account/trust validation, docs, PassRole |
| VPC/NAT/cost | Default none, plan review, bootstrap expansion |
| Scope/budget | Split Slice 3 at G4 if needed |
