# Discovery glossary

| Term | Meaning |
|---|---|
| **Chromium renderer** | Lambda adapter using puppeteer-core + @sparticuz/chromium, JS disabled, request interception, page settings. |
| **PdfArchiver** | Port for PDF/A post-processing; implemented with pdf-lib. |
| **Output intent** | sRGB ICC profile declaring the PDF/A colour space. |
| **XMP** | Metadata carrying `pdfaid:part`/`pdfaid:conformance`. |
| **Delivery channel** | `http`, `lambda`, `sqs`, `eventBridge` or `s3`. |
| **Ping** | POST `{success:true|false}` to `pingUrl` after channel delivery. |
| **Callback policy** | Allowlist + DNS/link-local/metadata checks for HTTP callbacks and pings. |
| **Render regression** | CI comparison of page count, text and appearance against reference PDFs. |
| **Power Tuning** | Lambda memory/cost tuning on representative documents. |
| **Throughput target** | Agreed jobs/minute and latency used for capacity and load tests. |
| **Caller/integrator role** | IAM role that may `sqs:SendMessage` only to the jobs queue; generated and output or provided. |
| **Worker execution role** | Lambda role that consumes jobs and publishes to `callback_target_arns`; generated or provided same-account. |
| **PassRole** | `iam:PassRole` permission the deploy role needs to attach a provided worker role to Lambda. |
| **Provided role** | An existing IAM role ARN owned by the deployer/integrator; the stack does not modify it. |
| **Bootstrap** | One-time Terraform for state/artifacts/OIDC roles; expanded for VPC and PassRole. |
