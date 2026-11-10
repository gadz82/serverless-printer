# Cost estimate — Final iteration

| Prompt | Estimate | Build tokens | Review tokens |
|---|---|---|---|
| P-201 Chromium renderer | L | 55,000 | 10,000 |
| P-202 PDF/A archiver | L | 45,000 | 9,000 |
| P-203 callback policy | M | 25,000 | 5,000 |
| P-204 delivery channels | L | 45,000 | 9,000 |
| P-205 render regression | M | 30,000 | 6,000 |
| P-206 local Chrome hardening | S | 12,000 | 3,000 |
| P-207 roles/bootstrap | L | 40,000 | 8,000 |
| P-208 alarms/runbook | S | 12,000 | 3,000 |
| P-209 release smoke | M | 25,000 | 5,000 |
| P-210 load/Power Tuning | M | 25,000 | 5,000 |
| P-211 cloud docs | S | 10,000 | 2,000 |
| **Total** | | **324,000** | **65,000** |

## Budget

- Warn 250,000; stop 600,000. Estimated total ~389k, under stop, above warning.
- Split Slice 3 at G4 if the plan grows past ~500k or cloud prerequisites are unavailable.
- P-201/P-202/P-204/P-207 are the L prompts; split any that exceed ~600 lines.

## Schedule

- 11 prompts, 5 waves; 10–14 engineering days.
- Cloud apply/verification remains operator-run; P-211 prepares the evidence checklist.
