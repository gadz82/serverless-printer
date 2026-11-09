# Cross-repo dependency ledger

Use this file at `.orchid/cross-repo-dependencies.md` in a multi-repo workspace. Record a
dependency as soon as it is discovered; never leave it only in chat, a prompt report, or a
commit message.

This ledger is the single source of truth for cross-repo edges. It is separate from
`.knowledge/index/cross-repo-dependencies.json`, which is a generated index of this file, and
from `.knowledge/index/dependencies.json`, which is the prompt DAG. Never edit the generated
index by hand.

| ID | Kind | Consumer | Provider | Contract | Version | Failure mode | Rollout | Consumer evidence | Provider evidence | Owner | Status | Last verified | Related |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEP-001 | api | `orchid-api/src/orders/client.ts` | `orchid-payments/POST /charge` | `charge.v1` | `1.2.0` | `timeout, 4xx` | `provider first` | `npm test` | `make integration` | `payments` | verified | `2026-11-05` |  |

## Status

- `open` — discovered; compatibility is not yet proven.
- `verified` — consumer/provider evidence and `Last verified` are recorded and current.
- `waived` — the human owner accepted the risk; `Related` names the `ADR-###`.
- `closed` — the edge was removed or no longer applies; record why in `Related`.

## Rules

- One row per consumer/provider edge, not one per service.
- `ID` is `DEP-###` and unique; never reuse or renumber.
- `Kind` is one of `api`, `event`, `package`, `schema`, `runtime`, `data`.
- `Consumer`/`Provider` start with an enabled `workspace.repos[]` ID, then `/`.
- `Contract` and `Version` are required and non-empty.
- `Failure mode` is required (`timeout`, `4xx`, `duplicate`, `ordering`, `version skew`, ...).
- `Rollout` is required; use `n/a` when there is no deployment-order constraint.
- `Consumer evidence`/`Provider evidence` are required for `verified`.
- `Owner` is required. `Status` is `open`, `verified`, `waived`, or `closed`.
- `Last verified` is required for `verified`; use an ISO date or a 7–40 char commit SHA.
- `Related` is optional comma-separated IDs; `waived` requires an `ADR-###`.
- Prefer project-scoped aliases or UUIDs in `Related` for stable resolution. An
  iteration-scoped alias (`R-###`, `T-###`, `P-###`) can repeat across iterations and resolves
  to the active (most recent) node; use `alias@iteration` or a UUID when you must pin a
  historical node.
- Never delete a row. Close it or mark it waived with a reason.

## CR checklist

- Contract and version match on both sides.
- Consumer and provider regression tests cover success and failure.
- Deployment order and rollback are safe.
- Timeout, retry, idempotency, and duplicate delivery are handled.
- Data/schema migration is compatible in both directions.
