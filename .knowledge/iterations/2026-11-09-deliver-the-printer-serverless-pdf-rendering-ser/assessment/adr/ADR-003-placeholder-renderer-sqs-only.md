# ADR-003 — Phase 1 uses a placeholder renderer and SQS-only delivery

- Status: proposed
- Date: 2026-11-09
- Deciders: ARCHITECT, TECH_LEAD, PM, human release owner
- Related: R-001, R-003, R-008, R-011, S-001, S-005, S-006

## Context

The kickoff Phase 1 exit criterion is a dummy job from the queue to the worker and back to an SQS
callback. Chromium packaging, PDF/A post-processing and the other delivery channels belong to
Phase 3. The public contract, however, already models `pdfA` and all five result channels. The
foundation must prove the real queue, storage, delivery, configuration and release path without
pretending to deliver production rendering or every channel.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Dependency-free placeholder PDF + SQS-only delivery (chosen) | Low | Low | High | Proves the foundation; output is not production rendering |
| Chromium and PDF/A now | High | High | Medium | Delays the contract and deploy path |
| `pdf-lib` placeholder | Low | Low | High | Valid PDF with one extra dependency; blurs the Phase 1/3 line |
| Narrow the contract to SQS only | Low | Medium | Low | Cleaner Phase 1, but breaks the specified public contract |

## Decision

Implement `PdfRenderer` with a deterministic, dependency-free minimal PDF producer behind the
domain port. Replace it with Chromium in Phase 3 without changing the use case, contracts or
result shape.

Implement only the `sqs` result channel. Keep all five channels in the contract. If a job requests
`http`, `lambda`, `eventBridge` or `s3`, fail non-retryably with `CALLBACK_NOT_ALLOWED` and a
message naming the unsupported channel. Do not invent a new public error code for a known Phase 1
limitation.

The bundled `_smoke` template identity is resolved through the manifest so the path matches the
future renderer.

## Consequences

- The end-to-end path is real; only the pixel-producing step is a stub.
- The placeholder is not evidence of PDF fidelity, font embedding or PDF/A conformance.
- The contract stays stable for Phase 3; callers see a clear non-retryable error for channels not
  yet available.
- The placeholder must never be described as production rendering in release notes.

## Rejected options

- Chromium now: too much packaging and fidelity risk before the foundation is proven.
- `pdf-lib` now: a valid PDF but an unnecessary runtime dependency; it enters with PDF/A.
- Contract narrowing: would create a breaking contract change in Phase 3.

## Risk acceptance

The human owner accepted a placeholder PDF for the Phase 1 exit when choosing the foundations
scope (assumption A-004). Real rendering risk is carried into Phase 3.
