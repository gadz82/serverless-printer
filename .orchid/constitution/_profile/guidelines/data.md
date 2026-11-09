# Data guidelines

Intent: change persisted data without losing it, locking the product out, or hiding an irreversible decision.

## Required

- Keep migrations small, ordered, and committed with the code that needs them.
- Use expand/contract for large tables: add compatible structures, backfill, switch reads, then remove old structures.
- Bound every backfill: batch size, progress signal, resume point, and a stop condition.
- A destructive or irreversible change needs a backfill plan, a rollback path or recovery plan, and an ADR.
- Test the migration and the backup restore against a realistic schema, including rollback or recovery.
- Deactivate before deleting; record the retention window and the approval for deletion.
- Give every hot-path query an index and a query plan; check the write cost of a new index.
- Keep production data out of tests, fixtures, logs, and examples.
- Make deletion explicit and auditable: actor, reason, scope, and result.

## Anti-patterns

- One unbounded transaction that rewrites or backfills a large table.
- "We can restore from backup" used as the rollback plan.
- Adding an index without checking the query plan and write amplification.
- Deleting rows still read by the application, or using production data to make a test realistic.
- A schema change without an ADR and an owner.

## Evidence

- Migration file and ordering, with the deploy step that runs it.
- Backfill progress signal and stop condition.
- Rollback or recovery command and result, or an ADR that states why rollback is impossible.
- Query plan and index for each hot path.
- Deletion approval, audit event, and retention window.

## Exceptions

The business owner decides whether data is retained or deleted. DBA blocks the mechanics until that decision and its audit trail are recorded; legal or privacy advice is escalated, never invented.
