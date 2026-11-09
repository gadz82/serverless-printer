# Project steering rules

Steering rules are project-owned, phase-aware rules for architecture, code style, examples,
and repository flow. They complement the constitution; they do not replace it.

Add a Markdown file with front matter:

```md
---
id: my-project-rule
title: My project rule
summary: One sentence a reviewer can cite.
kind: architecture # architecture | code_style | example | repository | process | custom
authority: blocking # advisory | blocking
phases: [discovery, logic_review]
tags: [architecture, project]
examples:
  - path: examples/my-rule.ts
    title: "Approved shape"
    language: typescript # use the project's language
---
# Rule
...
# Checks
...
# Evidence
...
```

The example language is illustrative. Shipped examples cover TypeScript, Go, Python, PHP,
Rust, Java, and Ruby.

Enable it in `orchid-sdd.yml`:

```yaml
steering:
  enabled: [architecture-boundaries, my-project-rule]
  phases:
    discovery: [architecture-boundaries, my-project-rule]
    logic_review: [architecture-boundaries, my-project-rule]
```

Run `orchid-sdd doctor`, then `orchid-sdd steering list` and
`orchid-sdd steering context --phase discovery`.
