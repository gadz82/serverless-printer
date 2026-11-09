# Steering rules

Steering rules are selectable, phase-aware contracts for **how** a project wants work shaped.
They complement the constitution:

- the constitution is the baseline for how code is written;
- a steering rule is an explicit project decision that can be enabled, disabled, and mapped to
  phases such as Discovery and Logic Review.

Each rule is a Markdown file with YAML front matter. The front matter is the machine contract;
the body is the human contract.

```md
---
id: my-rule
title: My rule
summary: One sentence a reviewer can cite.
kind: architecture # architecture | code_style | example | repository | process | custom
authority: blocking # advisory | blocking
phases: [discovery, logic_review]
tags: [architecture, boundaries]
examples:
  - path: examples/typescript/my-rule.ts
    title: "Approved shape"
    language: typescript
---
# Rule
...
# Checks
...
# Evidence
...
```

Rules are resolved by ID from `.skill/steering/` (defaults), then project search paths such as
`.orchid/steering/` and `domains/*/steering/`. A project file with the same `id` overrides the
default; `extends` is optional. Enable a rule in `steering.enabled` and assign it to a phase in
`steering.phases`.

```bash
orchid-sdd steering list
orchid-sdd steering list --phase discovery
orchid-sdd steering show architecture-boundaries
orchid-sdd steering context --phase logic_review
```

The core rules cover architecture boundaries, SOLID principles, dependency inversion and DI
containers, cross-language style gates and comment/memory discipline, examples, repository
flow, and SAGA coordination. Core rules live in `default-presets/`; optional rules live in
`available-presets/`, including hexagonal, onion, clean, DDD, CQRS, and event-driven
architecture, language-specific style gates, and repository workflows. Examples live under
`examples/` for TypeScript, Go, Python, PHP, Rust, Java, and Ruby. Preset-specific snippets live
under `examples/<language>/presets/<preset-id>/` and are declared in the preset’s `examples`
front matter; language style exemplars live at `examples/<language>/style-example.*`. Each
preset snippet carries an illustrative placement header mapping its components to files.

Enable only the architecture and repository patterns the project has actually chosen; several
code-style presets may be combined for a multi-language repository. Enabling competing
architecture or repository presets creates contradictory steering.
