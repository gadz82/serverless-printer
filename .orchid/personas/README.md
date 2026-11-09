# Project personas

Place project-specific persona overrides here as Markdown files with front matter:

```md
---
id: DBA
extends: default
authority: blocking
---
# Operating instructions
...
```

The skill defaults live in `.skill/personas/`. Project files override by ID
(`extends` is optional). See `docs/orchid-sdd-design.md` §8 for the contract.
The skill package also ships detailed role dossiers under `docs/personas/`.
