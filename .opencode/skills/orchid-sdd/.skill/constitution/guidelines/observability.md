# Observability guidelines

Intent: make the health, speed, correctness, and failure of every change visible before users report it.

## Required

- Every new service, job, or critical path defines its SLO or service-level objective and its primary failure signal.
- Dashboards answer three questions: is it up, is it fast, is it correct. Name the metric and the threshold for each.
- Every alert is actionable, owned, and linked to a runbook; an alert without an owner is noise.
- Logs, metrics, and traces share a correlation ID so a failure can be followed across boundaries.
- A deploy is not complete until the new signal is visible in the target environment.
- Test the rollback or kill switch, not only the forward deploy.
- Treat cost and capacity as operational signals; flag unbounded growth and name the limit.
- Define what normal looks like before the change, so the signal has a baseline.

## Anti-patterns

- A dashboard with no owner and no decision attached to it.
- Alerting on every error instead of on user-impacting symptoms.
- High-cardinality IDs in metric labels.
- "We will add observability after launch."
- A rollback plan that has never been executed.
- A green pipeline treated as production readiness.

## Evidence

- SLO or objective and the failure signal in the assessment artifact.
- Dashboard or query, alert rule, owner, and runbook link.
- Correlation ID visible in a log, metric, and trace sample.
- Rollback or kill-switch command and result.

## Exceptions

A low-risk internal change may use an existing signal instead of a new dashboard, provided the signal and owner are named. "No signal" is not an exception.
