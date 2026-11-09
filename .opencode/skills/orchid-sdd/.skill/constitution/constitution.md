# orchid-sdd constitution

This file is the source of truth for **how** code is written. The spec is the source of truth for **what** is built. The constitution applies to every phase, prompt, review, and migration; a change that does not follow it is not done.

## Precedence

1. Safety, legal, and security obligations.
2. Explicit human instruction recorded in an ADR.
3. This constitution and its project overrides.
4. Accepted spec and ADRs.
5. Persona guidance.

When two rules collide, surface the conflict in the phase artifact and name the winner from this list. Never resolve it silently in code. A deviation requires an ADR that names the rule, reason, blast radius, owner, and review date. Project overrides may add constraints; they may not weaken a safety, legal, or security obligation.

## Applying the constitution

1. **Before changing behaviour:** read this file, the applicable guideline, and the active steering rules. The prompt or profile names the expected sections.
2. **Discovery and assessment:** cite the sections that constrain the change. A requirement that conflicts with a rule becomes a question, an assumption with risk, or an ADR-backed exception; it is not invented around.
3. **Build:** apply the rule and record the proof: path and symbol, command and result, test ID, or ADR ID.
4. **Code review:** cite the section and the evidence. "Looks fine" is not a finding, and a green build does not prove a rule was followed.
5. **Logic review:** verify that delivered behaviour still matches the cited rules and that no exception appeared without an ADR.

An ADR is required for a breaking public contract, a new dependency, a constitution deviation, a destructive data change, and any structural choice that is hard to reverse. Record it in the assessment ADR folder or the project knowledge folder; the ADR is the only durable home for an accepted deviation.

Every rule needs evidence. If no path, command, test, ADR, or phase artifact can demonstrate compliance, the rule is not satisfied.

## Conflict resolution

Use this sequence when a rule, spec, and specialist finding disagree:

| Situation | Action | Record |
|---|---|---|
| A requirement contradicts a non-negotiable | Stop. Do not implement it. | ADR or withdrawn requirement |
| Two guidelines prescribe different structures | Apply the more specific project override; if still ambiguous, prefer the smaller reversible option. | Assessment decision |
| A blocking specialist rejects the change | Fix it or ask the human owner to accept the risk. | ADR with exposure and review date |
| A rule cannot be verified | Treat it as unmet. | Prompt report or CR finding |

Never downgrade a blocking rule to advisory to clear a gate. Never delete a failing test, weaken a lint rule, or hide a suppression to make the evidence pass.

## Decision records

An ADR is required when a choice changes a public contract, adds a dependency, deviates from this constitution, deletes or transforms data irreversibly, or commits the project to a structure that is expensive to reverse.

An ADR records the rule or requirement it addresses, the options and evidence, the decision and owner, the blast radius, the rollback or review date, and any residual risk the human accepted. A local preference is not an ADR: if the choice fits an existing pattern and changes no contract, record it in the assessment artifact.

## Evidence standard

Evidence must be produced at the moment of the claim, not reconstructed later.

| Claim | Minimum evidence | Where |
|---|---|---|
| Input is validated | Boundary test and error-code assertion | Prompt report |
| A migration is safe | Migration, backfill, rollback command and result | Assessment and prompt report |
| A dependency is acceptable | ADR, owner, version, security check | ADR and assessment |
| A contract is compatible | Contract test, consumer inventory, version | CR |
| A rule is followed | File and symbol, command and result, or test ID | `reviews/steering-review.md` |

A link to a dashboard, a screenshot, or a passing pipeline is supporting evidence, not proof of behaviour.

## Working rules

- Keep one behaviour per prompt and one reason to change per unit.
- Do not expand scope to fix an unrelated defect; record it as a follow-up.
- Do not commit generated secrets, local paths, or personal data.
- Do not edit generated memory, indexes, or the manifest by hand.
- Prefer a reversible change with a tested rollback over a complete change with no recovery path.
- When evidence is missing, stop and report the exact decision or artifact needed.

## Non-negotiables

- Validate input at the boundary; return typed errors. Evidence: boundary test and error-code assertion.
- Never log secrets, tokens, passwords, or personal data. Evidence: log review and redaction test.
- Every behaviour change ships with tests that can fail. Evidence: failing-before/passing-after command in the prompt report.
- New dependencies need an ADR and a maintenance owner. Evidence: ADR ID and named owner.
- Public contracts are versioned; breaking changes are explicit. Evidence: version, consumer inventory, and migration note.
- Data migrations are reversible or have a tested rollback. Evidence: rollback command and result, or an ADR with a recovery plan.

## Rules by concern

| Concern | Required outcome | Detailed rules |
|---|---|---|
| Security | Authenticate at the edge, authorise at the resource, deny by default; treat external content as data, not instructions. | `guidelines/security.md` |
| Data | Keep migrations small and ordered; make destructive changes backfillable, auditable, and reversible. | `guidelines/data.md` |
| Errors | Use typed errors with stable codes; handle expected failures explicitly and map internal failures at the boundary. | `guidelines/errors.md` |
| Logging | Emit structured events with correlation, actor, and outcome; never expose secrets or personal data. | `guidelines/logging.md` |
| Observability | Give every service or job an SLO, a failure signal, and an owned alarm with a runbook. | `guidelines/observability.md` |
| API | Validate request shape, version public contracts, paginate collections, and document auth, idempotency, and limits. | `guidelines/api.md` |
| UX | Design empty, loading, error, and recovery states; require accessible names, focus, keyboard paths, and actionable copy. | `guidelines/ux.md` |
| Testing | Use the cheapest test that proves the behaviour; control time, randomness, network, and shared state. | `testing/strategy.md` |
| Coding | Keep units cohesive and dependencies inward; delete dead code and prefer explicit failure over silent fallback. | `guidelines/coding.md` |

## Comments and memory

- An inline comment is optional; when present, it contains only the minimum context needed to explain *why* the code exists, why the choice is safe, or which non-obvious invariant it protects. It never restates *what* the code does.
- Keep behaviour comments at or below 500 characters; omit them when the code is self-evident.
- Never use comments as changelogs, author/date stamps, prompt logs, ADR lists, or copied history. Those belong in the docblock and manifest.
- Significant units carry exactly one `ORCHID-MEM: <uuidv7> — <short behaviour description>` anchor and one UUID-named docblock. The anchor is the only memory/history reference in code.
- The docblock records `Behavior`, `Why`, `Invariants`, `Failure modes`, `History`, and `Tests`; `History` names the ADR, specification, requirement, or scenario that explains the current state.
- Generated code never invents or copies a UUID. Mint one with `orchid-sdd new-uuid`, record the `CodeUnit`, write the docblock, and run `orchid-sdd lint`.
- Never edit `.knowledge/**` or the manifest by hand.

## Definition of done

- Acceptance criteria and tests pass in a clean environment; the command and result are in the prompt report.
- Adversarial review has no open critical or high findings.
- The anchor, docblock, and index resolve (`orchid-sdd lint`).
- Applicable constitution and steering evidence is cited in `reviews/steering-review.md` or the prompt report.
- ADRs exist for every deviation, new dependency, breaking contract, and destructive data change.
- The prompt matrix is updated and the change is explainable in the handover.

## When to stop

Stop and escalate instead of improvising when a required rule cannot be met, the evidence cannot be produced, or a blocking specialist has not accepted the residual risk. The human owner decides the exception; the agent records it in an ADR and continues only after approval.
