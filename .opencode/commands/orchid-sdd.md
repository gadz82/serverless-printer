---
description: Run the orchid-sdd SDD workflow. Explicit invocation only.
disable-model-invocation: true
---

Invocation: /orchid-sdd (OpenCode) or /orchid-sdd:run (Claude Code plugin)
Arguments: $ARGUMENTS
Sentinel: explicit

Load the orchid-sdd contract and execute the requested subcommand:

- In OpenCode, load the `orchid-sdd` skill.
- In the Claude Code plugin, read `${CLAUDE_PLUGIN_ROOT}/SKILL.md`.

Do not proceed unless the user explicitly invoked `/orchid-sdd` or `/orchid-sdd:run`.

Use the portable CLI for deterministic operations:
`orchid-sdd <command>` (or `node bin/orchid-sdd.mjs <command>` from the skill package).
