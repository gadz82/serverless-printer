# Cross-language examples

These snippets show the same small domain boundary in different languages. They are examples,
not templates to paste blindly. Each language keeps its own idioms; the shared ideas are an
explicit repository port, constructor/composition-root injection, and a real failure path.

| Language | Example |
|---|---|
| TypeScript | `typescript/hexagonal-port.ts`, `typescript/domain-service.ts` |
| Go | `go/domain_service.go` |
| Python | `python/domain_service.py` |
| PHP | `php/DomainService.php` |
| Rust | `rust/domain_service.rs` |
| Java | `java/DeactivateUser.java` |
| Ruby | `ruby/domain_service.rb` |

The `code-examples` steering rule lists these files so an agent can load the examples relevant
to the project’s language. Add project-specific examples under `.orchid/steering/examples/` and
reference them from a project rule.

During migration, the agent analyzes the existing code and proposes one to three examples for
every significant language in the project. It writes them only after explicit human approval,
then creates a blocking `.orchid/steering/code-examples.md` override. Build and code review must
follow those examples; a deviation requires an ADR.

## Preset snippets

Preset-specific snippets live under `<language>/presets/<preset-id>/` (for example
`typescript/presets/architecture-clean/place-order.ts`), and language style exemplars live at
`<language>/style-example.*`. The `examples` front matter on each steering rule is the source of
truth; load the snippet it names instead of guessing from this index.

Each preset snippet starts with a `Placement (illustrative)` block that maps its components to
suggested files and directories. The snippet keeps them together for readability; production code
splits them as listed and does not create generic placeholder files. Placement is logical, not a
build script: adjust package names and module boundaries to the language convention.

Process and repository presets do not ship code snippets: their evidence is the phase artifact,
branch graph, or CI result, not a code sample. Gate-only presets such as SonarQube apply to the
language exemplars; their evidence is the gate result, not a dedicated code sample.
