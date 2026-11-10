# Cost estimate — Slice 1

| Prompt | Estimate | Build tokens | Review tokens |
|---|---|---|---|
| P-101 template engine | L | 45,000 | 9,000 |
| P-102 template CLI | M | 28,000 | 6,000 |
| P-103 generic report + preview | M | 30,000 | 6,000 |
| P-104 network module | M | 30,000 | 7,000 |
| P-105 CI/docs | S | 12,000 | 3,000 |
| **Total** | | **145,000** | **31,000** |

## Budget

| Threshold | Value | Estimate |
|---|---|---|
| `per_iteration_warn` | 250,000 | 176,000 — under warning |
| `per_iteration_stop` | 600,000 | Not expected |
| `per_prompt_warn` | 40,000 | P-101 is at the warning line; split if it grows |

## Schedule

- 5 prompts, 4 waves, critical path P-101 → P-102 → P-103 → P-105.
- 4–6 engineering days including reviews.
- Slice 2 (Chromium/PDF-A/all channels) and Slice 3 (capacity/ops/cloud) follow as separate
  iterations per ADR-107.

## Controls

- Only P-101 edits the catalog/lockfile.
- P-103 uses the installed Chrome; no Lambda packaging in this slice.
- P-104 has no apply requirement; validate/plan with local fake credentials.
- P-105 is documentation/CI only.
