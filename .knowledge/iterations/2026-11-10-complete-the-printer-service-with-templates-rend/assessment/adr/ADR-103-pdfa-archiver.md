# ADR-103 — PDF/A is a best-effort pdf-lib post-processing step

- Status: proposed
- Date: 2026-11-10
- Deciders: ARCHITECT, DEV, QE, human release owner
- Related: R-108, S-118–S-119

## Context

Chromium does not produce PDF/A. The spec requires an optional post-processing step at eight
levels, with no validator in CI or production, and with explicit failure when safety checks fail.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| pdf-lib post-processing (chosen) | Medium | Medium conformance | High | Pure JS, no binaries |
| Ghostscript/other binary | High | High packaging | Low | Adds a binary and image/layer complexity |
| Chromium-only PDF/A claim | Low | Critical honesty | Low | False conformance claim |

## Decision

Use pdf-lib in a `PdfArchiver` adapter. Set the PDF version and document ID, embed an sRGB ICC
output intent (`sRGB2014.icc`), write XMP `pdfaid:part`/`pdfaid:conformance`, keep the Info
dictionary consistent, and fail with `PDFA_CONVERSION_FAILED` when encryption, JavaScript or an
unembedded font is detected. All eight levels are accepted; conformance remains best effort and is
not validated in CI or production.

## Consequences

- No binary dependency or image.
- Part-1/`a` levels may be limited by Chromium output; documentation must be honest.
- Unsafe PDFs fail explicitly instead of returning a mislabeled file.
- Cost is one extra parse/save pass per PDF, measured by the load test.

## Rejected options

- External binary: packaging and security cost.
- Claiming PDF/A without conversion: unacceptable.

## Risk acceptance

Conformance risk is accepted with documented best-effort limits and explicit failure paths.
