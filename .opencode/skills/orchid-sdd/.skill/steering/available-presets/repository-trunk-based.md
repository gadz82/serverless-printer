---
id: repository-trunk-based
title: Trunk-based repository preset
summary: Small, short-lived branches integrate frequently into a protected trunk.
kind: repository
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [git, trunk-based, small-batches, protected-main]
---
# Rule

Use trunk-based development. Work in short-lived branches, integrate small changes frequently,
and keep the default branch releasable. Long-lived feature branches are a smell; use feature
flags or incremental delivery instead.

# When to use

- The team integrates continuously and releases from the trunk.
- Changes can be split into small, independently reviewable batches.
- The default branch can stay releasable behind tests and feature flags.

# Conflicts

- Do not enable with Git-flow or XP mainline presets. Long-lived release branches or direct
  mainline integration contradict the trunk-based flow. The active repository preset overrides
  the core `repository-flow` default; choose one.

# Adds to the defaults

- Default `repository-flow` only requires a declared flow; this preset adds short-lived branch
  limits, a protected releasable trunk, and feature-flag ownership with a removal date.

# Checks

- Branches are short-lived and scoped to one reviewable change.
- The default branch remains protected and releasable.
- Integration happens before the branch diverges significantly.
- Feature flags have an owner and a removal date.
- Merge style is consistent with the project’s release policy.

# Evidence

Record branch names, integration commits, and the release decision in the prompt and closure
artifacts. Cite the branch lifetime and the flag removal date in `discovery/steering.md`.
