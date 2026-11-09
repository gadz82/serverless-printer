---
id: repository-xp-mainline
title: XP mainline repository preset
summary: Small, tested, reversible changes may integrate directly to main with explicit evidence.
kind: repository
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [git, xp, mainline, pairing, continuous-integration]
---
# Rule

Use XP-style mainline integration. Small, tested, reversible changes may go directly to the
default branch when the project explicitly permits it. Direct integration is never a shortcut
around tests, review, or a reversible rollout.

This preset conflicts with orchid-sdd's default “integration branch during build” flow. If you
enable it, change the execution and release configuration to match, and record the decision in
an ADR.

# When to use

- The team practices pairing or strong continuous review.
- Changes are small, tested, and reversible without a migration.
- Direct mainline integration is explicitly permitted by project policy.

# Conflicts

- Do not enable with Git-flow or trunk-based presets; their branch graphs contradict direct
  mainline integration. It also conflicts with orchid-sdd’s default integration-branch flow
  unless execution and release configuration are updated.

# Adds to the defaults

- Default `repository-flow` only requires a declared flow; this preset adds direct-integration
  controls, pairing/review evidence, feature flags, and a green pipeline before and after.

# Checks

- The default branch pipeline is green before and after integration.
- Changes are small enough to reverse without a migration.
- Pairing, review, or another independent check is recorded.
- The project uses feature flags or an equivalent rollout control for risky behavior.
- No direct integration while a blocking test, lint, or security gate is red.
- The execution configuration no longer assumes an integration branch that is not used.

# Evidence

Record the direct-integration decision, test/lint results, reviewer or pairing evidence, and
rollback path in the prompt and logic-review artifacts. The ADR names the configuration change
that makes direct mainline integration valid.
