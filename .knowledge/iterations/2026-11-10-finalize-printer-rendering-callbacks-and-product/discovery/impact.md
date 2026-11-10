# Discovery impact — final rendering, callbacks and production

| Boundary | Change | Requirements |
|---|---|---|
| Rendering | Chromium Lambda renderer, shared page settings, browser reuse/crash recovery | R-201 |
| PDF/A | pdf-lib archiver, ICC/XMP/Info, safety checks, all levels | R-202 |
| Delivery | HTTP/Lambda/EventBridge/S3 adapters, ping, FIFO reuse | R-203 |
| Callback security | Allowlist, DNS/link-local/metadata SSRF, IAM scoping | R-204 |
| Render regression | Reference PDFs and CI comparison | R-205 |
| Capacity | Throughput target, Power Tuning, load test | R-206 |
| Operations | Opt-in alarms, runbook, DLQ/template removal/rollback | R-207 |
| Release | Plain + PDF/A smoke, first real template live | R-208 |
| Cloud | Bootstrap/OIDC/rollback/branch protection | R-209 |
| Bootstrap IAM | Deploy role EC2/VPC permissions | R-210 |
| Local preview | File-request scoping to template dir | R-211 |
| Roles | Generated/provided caller role; generated/provided worker role; outputs; queue/pass-role wiring | R-212–R-218 |

## Ports and adapters

- `PdfRenderer` → `ChromiumPdfRenderer` (Lambda) and `LocalChromeRenderer` (preview).
- `PdfArchiver` → pdf-lib adapter.
- `ResultDelivery` → HTTP, Lambda, SQS, EventBridge, S3 adapters.
- New `CallbackPolicy`/allowlist resolver at the HTTP edge.
- Terraform: caller role (SQS send) and worker role (consume/publish) with create/existing modes.

## Not affected

No API/UI/database/environments/template upload/versioning. One deployment, one queue.

## Boundary risks

- Chromium and pdf-lib stay behind ports; domain/template engine remain framework-free.
- Caller and worker roles stay separate; provided roles are not modified.
- Network stays optional; `none` remains the default.
