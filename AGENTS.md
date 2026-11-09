<!-- orchid-sdd:begin -->
## orchid-sdd memory
- Code may carry `ORCHID-MEM: <uuid> — <short behaviour>` anchors. The anchor is the only memory/history reference in code; history lives in the UUID docblock. Resolve it before changing that code's behaviour.
- Inline comments explain why or a non-obvious invariant only; never restate code or copy history.
- Read `.knowledge/manifest.jsonld` and `.knowledge/index/` — plain JSON; the JSON-LD context is optional.
- Search by topic or question first: `orchid-sdd recall <topic|question|uuid|path>`.
- `.knowledge/index/recall.json` is generated and Git-ignored; never hand-edit it. When it is missing or stale, run `orchid-sdd index` (preferred) or let the first `recall` rebuild it. If the CLI is unavailable, warn the user before retrieval: "The recall index cannot be rebuilt without the orchid-sdd CLI. Retrieval is limited to `manifest.jsonld` and the versioned core indexes."
- Never edit `.knowledge/**`, the manifest, or docblocks of code you do not own. Write code; propose knowledge.
- Follow `.orchid/constitution/` for how code is written here.
- Read `orchid-sdd steering context --phase <phase>` before Discovery and Logic Review; apply every active rule and cite its ID.
- Before Build, read the Build steering context and follow the project code examples for the language; a deviation requires an ADR.
- Run `orchid-sdd route --phase <phase>` before work; if the current model/agent is unknown or mismatched, tell the user. Never switch automatically.
- Track development prompts with `orchid-sdd prompt start|step|complete`; save a checkpoint with `orchid-sdd handoff prepare` before changing harness.
- Ask before starting whether to create a feature branch and from which base; record the answer in the TRD. If not, stay on the current branch.
- Each prompt gets one disposable worktree and temporary branch; remove both immediately after CR and merge. Never leave an `orchid/<iteration>/<prompt-id>` branch behind.
- In workspace mode, record every discovered cross-repo dependency in `.orchid/cross-repo-dependencies.md`; cite the `DEP-###` row in prompt contracts and CR.
<!-- orchid-sdd:end -->
