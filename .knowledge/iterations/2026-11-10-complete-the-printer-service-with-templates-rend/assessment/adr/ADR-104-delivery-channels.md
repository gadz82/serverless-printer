# ADR-104 — Five delivery adapters with a shared callback policy

- Status: proposed
- Date: 2026-11-10
- Deciders: ARCHITECT, SECURITY, DEV, human release owner
- Related: R-109, R-110, S-120–S-123

## Context

The existing contract models five result channels and ping. Phase 3 must implement all of them
without leaking channel-specific logic into the use case, and must enforce the HTTP allowlist plus
DNS/SSRF protections.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| One `ResultDelivery` port with five adapters (chosen) | Medium | Medium | High | Shared result shape, testable channels |
| Separate use cases per channel | High | Medium | Medium | Duplication and drift |
| HTTP-only bridge for all channels | Low | High | Low | Breaks ARN targets and S3 semantics |

## Decision

Implement `http`, `lambda`, `sqs`, `eventBridge` and `s3` adapters behind the existing
`ResultDelivery` port. Keep the Phase 1 SQS FIFO rules. Add a `CallbackPolicy`/allowlist resolver
for HTTP values and every `pingUrl`, with DNS resolution and link-local/metadata blocking. Deliver
the channel result first, then the ping. IAM remains scoped to `callback_target_arns`.

## Consequences

- The use case stays channel-agnostic; each adapter owns headers, payload quirks and timeouts.
- HTTP security is one shared policy, not duplicated per adapter.
- The `s3` channel omits `printing`/`printingExpiresAt` and uses a presigned PUT.
- Channel failure handling stays explicit and testable.

## Rejected options

- Per-channel use cases: unnecessary duplication.
- HTTP bridge: changes ARN/S3 semantics.

## Risk acceptance

SSRF/allowlist risk is accepted with dedicated tests and a shared policy; cross-account targets
must grant the worker role on their side.
