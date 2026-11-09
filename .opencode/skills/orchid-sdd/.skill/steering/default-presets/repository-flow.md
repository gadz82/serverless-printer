---
id: repository-flow
title: Repository and change flow
summary: Every change follows a declared branch, review, merge, and release flow.
kind: repository
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [git, branching, trunk-based, gitflow, release, review]
---
# Rule

The project must declare one repository workflow and use it consistently:

- **Trunk-based:** short-lived branches, small changes, frequent integration, protected trunk.
- **Git-flow:** feature branches, develop/release/hotfix separation, explicit release branches.
- **XP mainline:** direct integration to main is allowed only for small, tested, reversible
  changes with the configured review or pairing evidence.

If no repository preset is active, orchid-sdd's build flow uses the iteration's
feature/integration branch only when the user opted in; otherwise prompt branches merge into
the current branch. The default branch is not touched during build. If
`repository-trunk-based`, `repository-gitflow`, or `repository-xp-mainline` is active, that
preset is authoritative for the concrete branch flow; this core rule checks that the declared
workflow and the actual commands agree. A project selecting XP mainline must also update its
execution and release configuration and record the decision in an ADR.

# Why

An undeclared branch flow produces unreviewed merges, orphaned worktrees, and a default branch
that is no longer releasable. Naming the flow and its merge target before work starts makes
review and rollback predictable; the repository preset supplies the concrete branch names.

# Checks

- The default branch is named and protected by policy.
- The branch owner and merge target are clear before work starts.
- A feature branch is created only when the user asks for one; otherwise work stays on the
  current branch.
- Each prompt uses one disposable worktree and temporary branch, deleted immediately after CR
  and merge.
- No orphan `orchid/<iteration>/<prompt-id>` branch or worktree remains at G5 or closure.
- Changes are small enough to review and reverse.
- Commit messages identify the requirement or prompt when the project uses traceability.
- Direct pushes to the default branch are either explicitly allowed by the selected preset or
  blocked.
- If a repository preset is active, no core or project rule contradicts its branch flow.
- Merge, squash, rebase, and release decisions are recorded, not improvised.
- Hotfix exceptions have an owner and a follow-up.

# Evidence

- Discovery: the workflow, feature-branch decision, and base branch in `discovery/steering.md`.
- Assessment: branch/release impact and rollback strategy.
- Build: branch names, worktree path, commits, merge target, and branch deletion in the prompt report.
- Code review: the integration diff, not the implementer’s local branch.
- Logic review: the delivered change is on the expected branch; no prompt branch, worktree, or
  stray merge remains.

# Exceptions

An exception to the branch or review flow requires an ADR or a recorded risk acceptance. A
direct push to main is never implicit. If the selected workflow permits it, the evidence must
still show tests and review.

# Example fit

No standalone branch example ships. The concrete fit is the selected repository preset:
`repository-trunk-based`, `repository-gitflow`, or `repository-xp-mainline`. Cite its branch
names and the actual commands in `discovery/steering.md`; `repository-flow` checks that the
preset and the commands agree.
