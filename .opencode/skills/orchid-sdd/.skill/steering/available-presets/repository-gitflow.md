---
id: repository-gitflow
title: Git-flow repository preset
summary: Feature, develop, release, and hotfix branches have explicit merge rules.
kind: repository
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [git, gitflow, release, hotfix]
---
# Rule

Use Git-flow. Feature branches merge into `develop`; releases are stabilized on a release
branch; hotfixes branch from the production tag or main branch and are merged back. The exact
branch names must be declared in the repository policy.

# When to use

- The product supports multiple versions or needs a stabilization window.
- Releases are cut from a release branch, not directly from every feature merge.
- Hotfixes must reach more than one long-lived branch.

# Conflicts

- Do not enable with trunk-based or XP mainline presets. The branch graphs contradict each
  other. The active repository preset overrides the core `repository-flow` default; choose one.

# Adds to the defaults

- Default `repository-flow` only requires a declared flow; this preset adds feature/develop/
  release/hotfix branch names, merge targets, and merge-back rules.

# Checks

- Every branch name identifies its type (feature, release, hotfix).
- Release branches contain only stabilization changes.
- Hotfixes are merged back to all affected long-lived branches.
- Version tags and release notes correspond to the shipped revision.
- No unreviewed direct push to a protected branch.

# Evidence

Record the branch graph, merge target, tag, and release notes in the prompt and closure
artifacts. Cite the branch names in `discovery/steering.md` and the merge commit in code review.
