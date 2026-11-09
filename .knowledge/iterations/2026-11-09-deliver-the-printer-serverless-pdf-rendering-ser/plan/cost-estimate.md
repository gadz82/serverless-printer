# Cost estimate

## Per prompt

| Prompt | Estimate | Expected build tokens | Review tokens |
|---|---|---|---|
| P-001 workspace and toolchain | M | 18,000 | 4,000 |
| P-002 contracts | M | 20,000 | 4,000 |
| P-003 domain | M | 22,000 | 4,000 |
| P-004 `_smoke` and manifest | S | 10,000 | 2,000 |
| P-005 worker | L | 40,000 | 8,000 |
| P-006 LocalStack and local sink | M | 25,000 | 5,000 |
| P-007 bootstrap | M | 20,000 | 5,000 |
| P-008 printer module and root | L | 35,000 | 7,000 |
| P-009 CI | M | 18,000 | 4,000 |
| P-010 release and smoke | L | 30,000 | 6,000 |
| **Total** | | **238,000** | **49,000** |

## Budget comparison

| Threshold | Value | Estimate |
|---|---|---|
| `per_iteration_warn` | 250,000 | Estimated total **287,000** — above warning, below stop |
| `per_iteration_stop` | 600,000 | Not expected |
| `per_prompt_warn` | 40,000 | P-005 and P-008 are at the warning line; split further if either grows |

The warning is expected near the end of the build. It is surfaced at G4; continuing past it is
allowed but must be reported, and the stop threshold requires `--force`.

## Schedule

- 10 prompts, 5 waves, critical path P-001 → P-002 → P-005 → P-006 → P-009.
- Estimated 5–7 engineering days for one developer, including review loops.
- Cloud verification (P-010 smoke) depends on the operator providing the remote and AWS account;
  the code and local checks can complete first.

## Cost controls

- One review per prompt with fresh context; batch review only for S-size prompts.
- No prompt adds a dependency outside the P-001 catalog, avoiding reinstall and lockfile churn.
- P-005 and P-008 are the only L prompts; each should be split if its diff exceeds ~600 lines.
- No spikes are planned; no unknown should consume a timebox.
