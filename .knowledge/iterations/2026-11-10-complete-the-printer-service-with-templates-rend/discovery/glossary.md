# Discovery glossary

| Term | Meaning |
|---|---|
| **Template engine** | `packages/template-engine`: Handlebars compilation, helper set, modes, placeholder AST, content hash and manifest construction. |
| **Mode** | `lenient` (missing fields empty), `strict` (any missing field fails) or `assume-objects` (only missing parent objects fail). |
| **Helper** | One of the fixed Handlebars helpers registered by the service, e.g. `eq`, `formatCurrency`, `formatDate`. Templates cannot add helpers. |
| **Placeholder AST** | The JSON tree derived from the Handlebars AST: `each` → array, `if`/`unless` → boolean, `with` → object, dotted path → nested key. |
| **Manifest** | Build-time JSON with template identity, bundle path, content hash, placeholders and release; bundled in the worker and attached to releases. |
| **template:new** | CLI command creating a template folder and `template.json` with a fresh UUID v4. |
| **template:validate** | CLI command checking identity, compilation, sample data and bundled-font warnings. |
| **template:check** | Git-based guard rejecting id/slug changes and slug reuse against a base ref. |
| **template:preview** | Local render through the same use case, using sample or supplied data and an installed Chrome. |
| **Chromium renderer** | `puppeteer-core` + `@sparticuz/chromium` adapter that renders HTML/Handlebars to PDF. |
| **PDF/A archiver** | pdf-lib post-processor that adds version/ID, sRGB ICC, XMP, Info consistency and safety checks. |
| **Output intent** | The embedded sRGB ICC profile declaring the PDF/A colour space. |
| **XMP** | PDF metadata carrying `pdfaid:part` and `pdfaid:conformance` for PDF/A. |
| **Channel** | A result delivery path: `http`, `lambda`, `sqs`, `eventBridge` or `s3`. |
| **Ping** | Optional POST to `pingUrl` after channel delivery with `{success: true|false}`. |
| **Allowlist** | `scheme://host[:port]` patterns for HTTP callbacks and ping URLs. |
| **SSRF** | Server-side request forgery; blocked by allowlist plus DNS and link-local/metadata checks. |
| **vpc_mode** | `none` (default), `create` (new VPC) or `lookup` (existing VPC). |
| **Endpoint** | VPC gateway/interface endpoint for S3, SQS, Lambda or EventBridge. |
| **NAT gateway** | Optional egress for HTTP callbacks outside the VPC. |
| **Render regression** | CI comparison of page count, text and appearance against reference PDFs. |
| **Power Tuning** | AWS Lambda Power Tuning to choose memory for 1-page and 20-page documents with/without PDF/A. |
| **Throughput target** | Agreed peak jobs/minute and acceptable latency used for concurrency, memory and load-test sizing. |
