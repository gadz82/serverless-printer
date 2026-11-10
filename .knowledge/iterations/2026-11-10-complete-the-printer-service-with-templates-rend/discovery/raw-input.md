> Iteration note: this is the verbatim `SPEC.md` source. The example template names in it are illustrative; this iteration implements the generic `generic-report` template instead.

# Printer — Specification

Version 0.4 (2026-11-09). This is a standalone project, independent of any company environment. It runs on AWS, lives in one GitHub repository, deploys with GitHub Actions and is provisioned entirely with Terraform.

**What the project doesn't have:**
- environments: there's a single deployment;
- template versions or statuses;
- a database;
- an API;
- a UI.

The SQS queue is the only way in.

## 1. Purpose and scope

Printer renders PDFs from HTML/Handlebars templates, asynchronously.

- Callers put a job on an SQS queue and get the result back through a callback channel they choose.
- A job names its template by **id or slug**.
- One job produces exactly one PDF, and **PDF/A output is an option of each job** (§4.1).
- **The service never keeps prints.**
- **Templates live in the repository** as static HTML/Handlebars files.
  - They're bundled into the render worker, together with a **manifest** generated at build time.
  - The manifest is also attached to each GitHub Release, so callers can see which templates exist and what data they expect.
- **There is no API, no UI** and no human-facing endpoint.

**Out of scope:**
- any template editor, UI or API;
- uploading templates at runtime;
- template versioning;
- third-party monitoring;
- PDF/A validation.

## 2. Architecture

| Component | Tech | Role |
|---|---|---|
| Render worker | Lambda (Node 24, x86_64, headless Chromium), triggered by SQS | Resolves the template, renders the PDF (optionally as PDF/A) and delivers the result |
| Template manifest | JSON generated at build time, bundled in the worker | id ↔ slug, files, content hash, placeholders. Also a GitHub Release asset |
| Jobs queue + DLQ | SQS | The only entry point |
| Prints bucket | S3 | Transient PDFs, which expire after 1 day |
| Artifacts bucket | S3, created by `bootstrap/` | Worker zips, one folder per release |
| Network (optional) | No VPC (default), a new VPC, or an existing one | Optional private networking for the worker |
| CI/CD | GitHub Actions with OIDC, semantic-release, commitlint | Validate, version, build, deploy |

```
caller ──SendMessage(job)──▶ jobs queue ──▶ render worker λ   (bundled templates + manifest)
                                              ├──▶ PDF/A post-processing (if requested)
                                              ├──▶ S3 prints/ (presigned GET)
                                              └──▶ callback: http | lambda | sqs | eventBridge | s3, then ping
```

## 3. Templates

### 3.1 Repository layout
```
templates/
├── annual-statement/
│   ├── template.json      # identity
│   ├── index.html         # Handlebars template
│   ├── styles.css
│   ├── fonts/…            # .ttf .otf .woff .woff2
│   ├── assets/…           # images
│   └── sample.json        # sample data, used for local preview and tests
└── _smoke/                # tiny template used by post-deploy smoke tests
```

```json
{
  "id": "6f1c2b0e-8a4d-4f7e-9c1a-2d3b4e5f6a7b",
  "slug": "annual-statement",
  "name": "Annual statement",
  "description": "Yearly account statement"
}
```

- **Identity:**
  - `id` is a UUID v4, generated once by `pnpm template:new`, that never changes.
  - `slug` is unique and immutable. It must match `^[a-z][a-z0-9-]{2,63}$`, which never looks like a UUID, so a job's `templateId` can safely hold either.
- **No versions, no statuses:** a template is its folder. Editing the files changes the output from the next deploy, and Git history is the history.
- **Traceability:** each print reports the template's content hash and the release, so it can be traced back to the exact content.
- **Removing a template:** jobs already queued for it fail with `TEMPLATE_NOT_FOUND`. This is accepted.
- **Language:** Handlebars, with a fixed helper set registered by the service, e.g. `eq`, `formatCurrency`, `formatDate`. Templates can't add helpers. Prototype access stays disabled, which is the Handlebars default.
- **Missing fields:** how they behave depends on the worker's `HANDLEBARS_MODE` (§4.8). The default is lenient: missing fields render as empty strings.
- **Self-contained:** every resource is inside the template folder, with fonts loaded through `@font-face` from `fonts/`. The renderer runs with JavaScript disabled and blocks every request except local files and data URIs.
- **Accessible PDF/A** (the `a` levels): templates should use semantic HTML, `lang` on `<html>`, and `alt` on images (§5.1).

### 3.2 Placeholder schema
The tooling reads the Handlebars AST and builds a JSON tree of the expected data. It's used to check `sample.json`, and it's stored in the manifest so callers know what to send.

| Handlebars | Becomes |
|---|---|
| `{{#each x}}` | array |
| `{{#if x}}` / `{{#unless x}}` | boolean |
| `{{#with x}}` | object |
| `{{a.b}}` | nested key |

### 3.3 Template tooling (CLI only)
| Command | Does |
|---|---|
| `pnpm template:new <slug>` | Creates the folder and `template.json` with a fresh UUID |
| `pnpm template:validate` | Checks the `template.json` schema, unique ids and slugs, and Handlebars compilation. Checks `sample.json` against the placeholders. Warns, without failing, about any CSS `font-family` that isn't bundled and isn't a default font |
| `pnpm template:check [--base <ref>]` | Git-based guard: compares `templates/*/template.json` with the base commit and fails if an existing template's `id` or `slug` changed, or a slug was reused by a different id |
| `pnpm template:preview <slug> [--data file] [--pdfa <level>] [--strict]` | Renders a PDF locally with the same renderer code and a local Chrome. Uses `sample.json` unless `--data` is given |
| `pnpm template:manifest` | Builds `templates.manifest.json` (run by the build) |

### 3.4 Manifest
`templates.manifest.json` lists, for every template:
- `id` and `slug`;
- `name`;
- path inside the bundle;
- `contentHash`, a SHA-256 over the sorted files;
- placeholders.

It also records the `release`.

**Where it's used:**
- **Render worker:** the manifest is bundled in the zip, and the worker resolves `templateId` (id or slug) from it alone. What gets rendered is always exactly what was deployed, and there's nothing to keep in sync.
- **GitHub Release:** when semantic-release cuts a release, the workflow attaches the manifest as a release asset (§7.3). That's how callers discover templates and placeholders.

## 4. Jobs and rendering

### 4.1 Job message (inbound SQS)
```jsonc
{
  "templateId": "<uuid> | <slug>",
  "refId": "string | number | object",       // echoed back unchanged
  "options": {
    "pdfA": false                            // false (default) or a level from §5.1, e.g. "PDF/A-2b", "PDF/A-3a"
  },
  "webhooks": {
    "success": {
      "pingUrl": "https://… | null",
      "channel": "http | lambda | sqs | eventBridge | s3",
      "value": "https url | lambda ARN | queue ARN | bus ARN | presigned PUT url"
    },
    "failure": {
      "pingUrl": "https://… | null",
      "channel": "http | lambda | sqs | eventBridge",
      "value": "https url | lambda ARN | queue ARN | bus ARN"
    }
  },
  "payload": { }                              // Handlebars context
}
```
- **One message, one print. This is a constraint.** A message can be at most 1 MiB on SQS, or 256 KB if it arrives through EventBridge.
- `options` is optional. Without it, the job produces a standard PDF.
- `options.pdfA` must be one of the levels enabled by `PDFA_ALLOWED_LEVELS` (§4.8).

### 4.2 Processing
1. **Validate** the message against its JSON Schema, and `options.pdfA` against the enabled levels. If it's invalid but its failure webhook can be read, send the failure webhook; otherwise the message goes to the DLQ.
2. **Check the allowlist** for every `http` value and every `pingUrl` (§4.6).
3. **Resolve** `templateId` (id or slug) in the bundled manifest.
4. **Render:** compile Handlebars with the payload (honouring `HANDLEBARS_MODE`) and produce the PDF (§5).
5. **PDF/A:** if `options.pdfA` is set, post-process the PDF to that level (§5.1).
6. **Store** `prints/<printId>.pdf`. For the `s3` channel, skip this and PUT directly to the caller's URL.
7. **Deliver** the result on the channel, then send the ping.

Rules:
- **Print id:** `printId = UUIDv5(namespace, inbound SQS messageId)`. A retry overwrites the same object, and callers can deduplicate on the id.
- **Retries:** the DLQ catches messages after `max_receive_count` receives (default 5).
  - Retryable errors throw and are retried.
  - On the last attempt the worker sends the failure webhook and deletes the message.
  - If the failure webhook itself can't be delivered, the message goes to the DLQ.
- **Non-retryable errors** send the failure webhook immediately (§4.4).
- **Batches:** batch size 1–5, rendered one after another on the same browser, with `ReportBatchItemFailures`. The event source mapping's `maximum_concurrency` caps the fleet; it's a Terraform input with a minimum of 2.
- **Duplicates:** SQS delivers at least once, so callers must deduplicate on `printId`.

### 4.3 Result payloads
Success:
```json
{
  "success": true,
  "printId": "3f0c…",
  "refId": "<as sent>",
  "printing": "https://…presigned GET…",
  "printingExpiresAt": "2026-11-09T10:15:00Z",
  "sha256": "…",
  "sizeBytes": 48211,
  "pdfA": "PDF/A-2b",
  "template": { "id": "6f1c…", "slug": "annual-statement", "contentHash": "…", "release": "v1.4.0" },
  "renderedAt": "2026-11-09T10:00:00Z"
}
```
- `pdfA` is `null` for a standard PDF.
- For the `s3` channel, the PDF goes to the caller's URL and `printing` is omitted.

Failure:
```json
{
  "success": false,
  "printId": "3f0c…",
  "refId": "<as sent>",
  "template": { "id": "6f1c…", "slug": "annual-statement", "contentHash": "…", "release": "v1.4.0" },
  "error": { "code": "PDF_RENDER_FAILED", "message": "…", "retryable": true, "attempts": 5 },
  "failedAt": "2026-11-09T10:00:05Z"
}
```

`template` is `null` when the template couldn't be resolved.

**Ping:** after the channel delivery, the worker POSTs `{"success": true|false}` to the matching `pingUrl`, if one was given. For the `s3` channel the ping is the only notification.

### 4.4 Error codes
| Code | Retryable | Meaning |
|---|---|---|
| `INVALID_MESSAGE` | no | The message doesn't match the job schema |
| `PDFA_LEVEL_NOT_ALLOWED` | no | `options.pdfA` isn't in `PDFA_ALLOWED_LEVELS` |
| `TEMPLATE_NOT_FOUND` | no | No template with that id or slug in the deployed bundle |
| `CALLBACK_NOT_ALLOWED` | no | An `http` value or `pingUrl` isn't on the allowlist |
| `TEMPLATE_RENDER_FAILED` | no | Handlebars error, including missing fields in `strict` / `assume-objects` mode |
| `PDFA_CONVERSION_FAILED` | no | The PDF/A post-processing step failed (§5.1) |
| `PDF_RENDER_FAILED` | yes | The engine failed |
| `DELIVERY_FAILED` | yes | The success channel failed on every attempt |

### 4.5 Delivery channels
| Channel | `value` | Delivery |
|---|---|---|
| `http` | https URL on the allowlist | POST JSON with header `X-Printer-Print-Id` and a 5 s timeout. Any 2xx counts as delivered |
| `lambda` | function ARN | `Invoke` with `InvocationType=Event`. The body is the result |
| `sqs` | queue ARN | `SendMessage` with the result as the body. For a queue ending in `.fifo`, see the FIFO rules below |
| `eventBridge` | bus ARN | `PutEvents` with Source `EVENT_SOURCE` (default `printer`) and DetailType `printer.print.succeeded` / `printer.print.failed`. Detail is the result |
| `s3` (success only) | presigned PUT URL | PUT with `Content-Type: application/pdf` |

FIFO rules for `sqs`:
- `MessageGroupId` is `refId` as a string. If `refId` isn't a string, or is longer than 128 characters, it's replaced by its SHA-256 hex.
- `MessageDeduplicationId` is `SHA-256(refId + inbound messageId)`.

**Permissions:**
- The worker role may call `lambda:InvokeFunction`, `sqs:SendMessage` and `events:PutEvents` only on the ARN patterns in `callback_target_arns`. If `organization_id` is set, there's also an `aws:ResourceOrgID` condition.
- Targets in other accounts must grant the worker role access on their side.

### 4.6 Callback allowlist
- An entry is a `scheme://host[:port]` pattern. The host can be exact, or a `*.` wildcard that matches subdomains.
- It applies to `http` channel values and to every `pingUrl`.
- It's set by the Terraform variable `callback_allowlist` and passed to the worker as the env var `CALLBACK_ALLOWLIST` (JSON).
- **Size limit:** Lambda caps all env vars together at 4 KB, so the list must fit within that.
- Whatever the allowlist says, the worker resolves DNS and refuses link-local and metadata addresses such as `169.254.169.254`.

### 4.7 Retention
- Prints expire through an S3 lifecycle rule after **1 day**, the S3 minimum.
- Presigned GET URLs last `PRESIGN_TTL_SECONDS`, 15 minutes by default.

### 4.8 Worker configuration (env vars, set by Terraform)
| Env var | Terraform variable | Default | Effect |
|---|---|---|---|
| `HANDLEBARS_MODE` | `handlebars_mode` | `lenient` | `lenient`: missing fields render empty. `strict`: any missing field fails the job, so optional fields must be sent as `null`/`false`, and `{{^x}}` only works when `x` is present. `assume-objects`: fails only when a parent object is missing, e.g. `customer` in `customer.name` |
| `PDFA_ALLOWED_LEVELS` | `pdfa_allowed_levels` | every level in §5.1 | Comma-separated list of the levels jobs may request |
| `CALLBACK_ALLOWLIST` | `callback_allowlist` | `[]` | §4.6 |
| `EVENT_SOURCE` | `event_source` | `printer` | EventBridge Source for callbacks |
| `PRESIGN_TTL_SECONDS` | `presign_ttl_seconds` | `900` | Lifetime of the `printing` URL |
| `PRINTS_BUCKET` | — | set by the module | Where prints are stored |

## 5. PDF engine: headless Chromium
- **Engine:** `puppeteer-core` with `@sparticuz/chromium`, pinned to a release that supports Node 24. It sits behind the `PdfRenderer` port, and PDF/A sits behind a `PdfArchiver` port.
- **Packaging:** no custom image and no layer.
  - A Lambda on `nodejs24.x` and **x86_64**, because the npm package only ships x64 binaries.
  - Chromium is bundled in the zip (~65 MB) and marked external in the bundler.
  - CI uploads the zip to the artifacts bucket, and Terraform deploys it from `s3_key`. The zip is over the 50 MB direct-upload limit.
  - At cold start the binary is decompressed into `/tmp`; the default 512 MB is enough.
- **Memory:** start at 1,536 MB, then tune with AWS Lambda Power Tuning on a 1-page and a 20-page document, with and without PDF/A.
- **Browser reuse:** launch Chromium once per instance, open a new page per job, and relaunch after a crash.
- **Rendering settings:**
  - `setJavaScriptEnabled(false)`;
  - request interception that allows only bundled files and data URIs;
  - `page.pdf()` with A4, `printBackground`, `preferCSSPageSize`, `tagged: true`, and header/footer templates using `pageNumber`/`totalPages`;
  - payload values always go through `{{ }}`, which escapes HTML.
- **Timeouts:** the function timeout is 60 s, and the queue's visibility timeout is at least 6× that.
- **Maintenance:**
  - pin `puppeteer-core` to the Chromium major of `@sparticuz/chromium`;
  - let Renovate or Dependabot bring Chromium updates;
  - run a render regression test in CI that compares page count, text and appearance against reference PDFs.

### 5.1 PDF/A option
Chromium doesn't produce PDF/A, so when a job asks for it, the worker post-processes Chromium's output with **pdf-lib** (pure JavaScript, no binaries).

**What the post-processing does:**
- sets the PDF version and a document ID in the trailer;
- embeds an **sRGB ICC output intent**, with `sRGB2014.icc` bundled in the worker;
- writes **XMP metadata** with `pdfaid:part` / `pdfaid:conformance`, plus title, producer, creation date and language (from `<html lang>`), and keeps the Info dictionary consistent with it;
- checks that there's no encryption, no JavaScript and that every font is embedded. If any check fails, the job fails with `PDFA_CONVERSION_FAILED`.

| Level | Meaning | Notes for this renderer |
|---|---|---|
| `PDF/A-1b` | Basic visual fidelity, PDF 1.4 | Forbids transparency, which Chromium's output often contains |
| `PDF/A-1a` | 1b plus accessibility (tagged structure) | As 1b, and also relies on Chromium's tagged output |
| `PDF/A-2b` | Basic visual fidelity, PDF 1.7, transparency allowed | The most reliable level with Chromium |
| `PDF/A-2u` | 2b plus Unicode text mapping | Chromium writes ToUnicode maps |
| `PDF/A-2a` | 2u plus accessibility | Relies on `tagged: true`, semantic HTML, `lang` and `alt` |
| `PDF/A-3b` / `3u` / `3a` | Same as part 2, and file attachments are allowed | Same notes as part 2 |

**Which levels jobs may request:** all of the above by default. `pdfa_allowed_levels`, passed to the worker as `PDFA_ALLOWED_LEVELS`, restricts the list.

**No validation:** neither CI nor production runs a PDF/A validator. Conformance is best effort, and this matters most for the part-1 and `a` levels (see the notes in the table above).

**Cost:** one extra parse-and-save pass per PDF. The load test measures it.

## 6. Infrastructure (Terraform only)

### 6.1 Layout
```
infra/
├── bootstrap/            # applied once by an admin
├── modules/
│   ├── network/          # optional: create or look up a VPC
│   └── printer/          # everything else in this section
├── main.tf               # the deployment: calls printer (and network if vpc_mode != "none")
├── variables.tf  backend.tf  terraform.tfvars  .terraform.lock.hcl
```
- **Versions:** Terraform ≥ 1.11, AWS provider `~> 6.0`.
- **State:** an S3 backend with native locking (`use_lockfile = true`), key `printer/terraform.tfstate`.
- **Naming:** resources are named with `name_prefix`, which defaults to `printer`.

### 6.2 `bootstrap/` (once)
- **State bucket:** versioned, encrypted, public access blocked.
- **Artifacts bucket** `<prefix>-artifacts`: worker zips under `<release>/`, versioned and encrypted.
- **GitHub OIDC provider** `token.actions.githubusercontent.com`.
- **Deploy role**, trusting only `repo:<owner>/<repo>:ref:refs/heads/main` with audience `sts.amazonaws.com`.
- **Read-only plan role**, trusting `repo:<owner>/<repo>:pull_request`.

### 6.3 Network: optional (`vpc_mode`)
| `vpc_mode` | Behaviour |
|---|---|
| `"none"` (default) | The worker runs outside any VPC. It reaches AWS services and `http` callbacks over AWS's own network and the internet, with no NAT or endpoints to manage |
| `"create"` | `modules/network` creates a VPC (`vpc_cidr`, `az_count`): private subnets, and optionally public subnets and a NAT gateway (`enable_nat_gateway`) |
| `"lookup"` | Uses an existing VPC, by `vpc_id` or `vpc_tags`, plus `subnet_ids` or `subnet_tags` |

When `vpc_mode` is `create` or `lookup`:
- The worker is attached to the private subnets, using `worker_security_group_id`.
- **Why use a VPC at all:** typically so `http` callbacks can reach private hosts.
- **VPC endpoints:** an optional gateway endpoint `s3`, and interface endpoints `sqs`, `lambda` and `events` for the AWS-service callbacks.
- **NAT:** `http` callbacks to hosts outside the VPC and its connected networks need a NAT gateway.

### 6.4 `modules/printer`
| Resource | Details |
|---|---|
| Jobs queue + DLQ | SSE-SQS, `max_receive_count`, and a visibility timeout of at least 6× the worker timeout. Queue policy: only `allowed_sender_account_ids`, `allowed_sender_principal_arns` or `organization_id` may send |
| EventBridge rule (optional) | `job_rule = { bus_name, event_pattern }` → jobs queue. The rule is also named in the queue policy |
| Prints bucket | SSE-KMS, public access blocked, TLS only, versioning off, lifecycle expiry after 1 day. Only the worker role may write |
| KMS key | For the prints bucket. Key policy for the worker role |
| Render worker Lambda | `nodejs24.x`, `x86_64`, 1,536 MB, 60 s. Env vars from §4.8, and VPC config only if `vpc_mode != "none"`. Code from `s3://<artifacts>/<release>/render-worker.zip`, published version plus alias `live`. Event source mapping with `batch_size`, `scaling_config.maximum_concurrency` and `ReportBatchItemFailures`. Optional reserved concurrency |
| IAM | Worker: consume the jobs queue, write and read `prints/*`, KMS, callbacks on `callback_target_arns` |
| CloudWatch | Log group with `log_retention_days`. Alarms for DLQ depth and worker errors, **off by default** (`enable_alarms = false`), sent to `alarm_sns_topic_arn` |

### 6.5 Main inputs
| Input | Default / example |
|---|---|
| `name_prefix`, `region` | `printer`, `eu-central-1` |
| `release` | Set by the deploy workflow (§7.3) |
| `artifacts_bucket` | Output of `bootstrap/` |
| `vpc_mode` and the network inputs (§6.3) | `"none"` |
| `allowed_sender_account_ids` / `allowed_sender_principal_arns` / `organization_id` | Who may send jobs |
| `callback_target_arns`, `callback_allowlist` | Callback permissions and allowlist |
| `handlebars_mode` | `lenient` |
| `pdfa_allowed_levels` | All levels in §5.1 |
| `event_source`, `presign_ttl_seconds` | `printer`, `900` |
| `max_receive_count`, `batch_size`, `maximum_concurrency`, `reserved_concurrency` | 5, 5, 10, `null` |
| `enable_alarms`, `alarm_sns_topic_arn`, `log_retention_days` | `false`, —, 30 |

## 7. GitHub repository and workflows

### 7.1 Repository layout
```
printer/
├── apps/
│   └── render-worker/     # SQS adapter, PdfRenderer, PdfArchiver, delivery channels; bundles templates/ + manifest
├── packages/
│   ├── domain/            # entities, ports, use cases — no AWS imports
│   ├── template-engine/   # Handlebars compile (modes), helper set, placeholder tree, content hash, manifest
│   └── contracts/         # job/result JSON Schemas, generated types
├── templates/             # §3.1
├── scripts/               # template:new | validate | check | preview | manifest, smoke test
├── infra/                 # §6
├── .github/workflows/     # ci.yml, release.yml
├── .husky/commit-msg      # local commitlint hook
├── commitlint.config.js   # @commitlint/config-conventional
├── .releaserc.json        # semantic-release config
├── CHANGELOG.md           # generated by semantic-release
└── docker-compose.yml     # LocalStack (SQS, S3) + callback sink
```

### 7.2 Commit rules and `ci.yml` (pull requests)
- **Conventional Commits, enforced:**
  - **Locally:** a husky `commit-msg` hook runs commitlint.
  - **In CI:** commitlint checks every commit in the PR, and the PR title, which becomes the commit message on squash merge.
  - **Branch protection on `main`:** PRs only, squash merge, required checks, linear history.
- **Code:** pnpm install, lint, typecheck, unit tests.
- **Templates:** `template:validate`, plus `template:check --base origin/main`.
- **Integration:** tests against LocalStack, run as a service container.
- **Render regression:** on `ubuntu-latest`, which is x86_64, so it uses `@sparticuz/chromium` itself. Covers plain PDFs and PDF/A post-processing, but not PDF/A validation.
- **Terraform:**
  - `fmt -check`, `validate` and `tflint`;
  - `plan` through the read-only OIDC role, with the summary posted on the PR.

### 7.3 `release.yml` (every push to `main`)
Runs in the `deploy` concurrency group, so deploys never overlap.
1. **Version:** **semantic-release** reads the Conventional Commits since the last tag.
   - If they warrant a release, it computes the next SemVer, tags `vX.Y.Z`, publishes a GitHub Release and commits `CHANGELOG.md` with `[skip ci]`. `release` is set to `vX.Y.Z`.
   - Otherwise (e.g. only `docs:` or `chore:` commits), `release` is set to `sha-<short sha>`.
2. **Build:** package `render-worker` with `templates/` and the manifest, then upload `render-worker.zip` to `s3://<artifacts>/<release>/`.
3. **Authenticate:** assume the deploy role through OIDC.
4. **Deploy:** `terraform apply -var release=<release>`.
5. **Smoke test:** send a job for `_smoke` (by slug), once plain and once with `pdfA`, with an `sqs` callback to a smoke-results queue, and wait for the results.
6. **Publish the manifest:** if a release was cut, attach `templates.manifest.json` to the GitHub Release.

- **Rollback:** dispatch `release.yml` manually with an earlier `release`, which skips the versioning and build steps and only runs apply and the smoke test.
- **Credentials:** no static AWS keys anywhere. All access is OIDC, and the deploy role can only be assumed from `main`.

## 8. Engineering rules
- **Hexagonal architecture and SOLID:**
  - the domain and use cases depend only on ports;
  - adapters (SQS, S3, Chromium, pdf-lib, the five channels) sit at the edges;
  - the same render use case serves the SQS adapter and `template:preview`.
- **Local first:**
  - docker-compose runs LocalStack and a callback sink that records deliveries;
  - the worker runs as plain Node;
  - locally the renderer uses an installed Chrome, because `@sparticuz/chromium` only runs on Linux.
- **Tests:**
  - unit tests for the domain, Handlebars modes, placeholder extraction, manifest, guard and channels (with fakes);
  - integration tests on LocalStack;
  - contract tests against `packages/contracts`;
  - render regression;
  - smoke tests after deploy.

## 9. Security summary
- **Entry point:** the SQS queue is the only one. There's no API and no human-facing endpoint, and only the listed accounts, principals or organization can send.
- **Callbacks:**
  - an `http` allowlist with DNS and SSRF checks;
  - AWS targets limited to `callback_target_arns`.
- **Prints:** encrypted, presigned URLs that expire, deleted after 1 day.
- **Rendering:** JavaScript off, network blocked, Handlebars escaping, fixed helper set.
- **CI/CD:** OIDC only, deploys only from `main`, Conventional Commits enforced.

## 10. Open items
1. **Throughput target:** expected peak jobs per minute and acceptable latency. These set `maximum_concurrency`, memory and the load test.

## 11. Kickoff plan
| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Contracts | <ul><li>Job/result JSON Schemas</li><li>Throughput target</li></ul> | Contracts merged in `packages/contracts` |
| 1. Skeleton | <ul><li>GitHub repo, pnpm workspace, TypeScript, Vitest</li><li>commitlint, husky, semantic-release</li><li>docker-compose with LocalStack</li><li>`ci.yml` and `release.yml`</li><li>`bootstrap/` applied</li><li>A minimal `modules/printer` (queue, bucket, worker) deployed through OIDC</li></ul> | A dummy job goes from the queue to the worker and back to the sqs callback, on a release cut by semantic-release |
| 2. Templates | <ul><li>`template-engine` with the Handlebars modes</li><li>Manifest</li><li>`template:new`, `validate`, `check`, `preview`</li><li>Optional `modules/network`</li></ul> | A template added in the repo renders by id and by slug after deploy |
| 3. Rendering | <ul><li>Chromium renderer</li><li>PDF/A post-processing at every level</li><li>The five channels, ping, failure handling</li><li>Allowlist</li><li>Power Tuning</li><li>Load test</li></ul> | Every channel passes end to end, with and without PDF/A |
| 4. Production readiness | <ul><li>Alarms (opt-in)</li><li>Runbook covering rollback, DLQ redrive and template removal</li><li>Smoke tests</li></ul> | First real template live |
