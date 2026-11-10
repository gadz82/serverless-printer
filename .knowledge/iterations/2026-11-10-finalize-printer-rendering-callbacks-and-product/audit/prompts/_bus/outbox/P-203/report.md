# P-203 implementation report

- Prompt: P-203 — Add the callback allowlist, DNS and SSRF policy
- Branch: `orchid/2026-11-10-finalize-printer-rendering-callbacks-and-product/P-203`
- Status: complete

## Delivered

- `CallbackPolicy` with exact/wildcard allowlist matching, explicit scheme/port rules and
  `https`-first behavior.
- DNS resolution with injectable resolver; blocks link-local, metadata, loopback, non-routable and
  mixed unsafe answers; allows named private VPC hosts.
- `assertAllowed`/`assertTargetAllowed` throwing non-retryable `CallbackNotAllowed`; target check
  covers the HTTP success/failure values and every ping URL; other channels are skipped.
- IPv4/IPv6 parsing incl. mapped/compatible forms; no URL/path logging; 55 focused tests.

## Review

Independent reviewer: PASS for the policy scope. Medium integration obligations for P-204:

1. Pin the validated DNS address in the actual HTTP request (or revalidate immediately before
   connecting) to close the rebinding/TOCTOU gap.
2. Preserve `CallbackNotAllowed` through `deliverSuccess` instead of wrapping it as retryable
   `DeliveryFailed`; validate both success and failure targets.
3. Disable redirects or revalidate each hop.
4. Keep `allowLoopback` false in production; the S3 presigned URL is intentionally skipped by the
   policy per the contract.

## Acceptance

| Command | Result |
|---|---|
| `pnpm --filter @printer/render-worker test` | PASS — 206 tests |
| Typecheck, lint, Prettier | PASS |
| `pnpm test` on main after merge | PASS — 472 tests |

## Residual risks

- Redirects, DNS pinning and `CallbackNotAllowed` propagation are P-204 work.
- Special-use IPv6/NAT64 ranges are not unwrapped; documented.
- Default DNS resolver has no timeout.
- Allowlist normalization accepts some non-canonical URL forms; low.
