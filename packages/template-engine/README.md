# @printer/template-engine

Shared Handlebars compilation, placeholder extraction, content hashing and release manifests for
the printer worker, CLI and build scripts. The package is framework-free: it has no AWS or Chromium
imports, and file access is limited to `node:fs`.

## API

```ts
compileTemplate(source, { mode, helpers? }): (data?) => string
extractPlaceholders(source): PlaceholderTree
hashTemplateFiles(directoryOrFiles): Promise<string>
buildManifest(root, release?): Promise<TemplateManifest>
validateTemplateDescriptor(descriptor): TemplateDescriptor
```

`compileTemplate` compiles once and returns a render function. The render function applies the
mode's pre-render data check, then renders with HTML escaping on and prototype access off.

## Modes

| Mode             | Missing leaf          | Missing parent object/array                              | Missing block/helper argument             |
| ---------------- | --------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `lenient`        | empty                 | empty                                                    | empty                                     |
| `strict`         | `TemplateRenderError` | `TemplateRenderError`                                    | `TemplateRenderError`                     |
| `assume-objects` | empty                 | `TemplateRenderError` for `with`/`each` and nested paths | empty for `if`/`unless` and helper values |

Handlebars' `strict` and `assumeObjects` options do not validate block arguments such as
`{{#if active}}` or `{{#each items}}`. The engine therefore derives a placeholder tree and checks
the supplied data before rendering:

- `strict` requires every referenced root path to be an own property. `null` and `false` count as
  present; nested paths recurse through objects and arrays.
- `assume-objects` requires `object`/`array` markers and nested parents to exist with the right
  shape, but allows a missing leaf inside a present parent and a missing `if`/`unless` boolean.
- `lenient` performs no pre-check.

The tree cannot see inside `each` item or `with` object contexts. The engine therefore also wraps
the built-in `if`, `unless`, `each`, `with` and fixed `eq` helpers: in `strict`, an `undefined`
argument throws `TemplateRenderError` (`null`/`false` are present); in `assume-objects`, `each` and
`with` still throw for `undefined`, `if`/`unless` take the false path, and `eq` returns false.
`lenient` is unchanged. `formatCurrency` and `formatDate` return an empty string for
`undefined`/`null` in `lenient` and `assume-objects`, and throw `TemplateRenderError` in `strict`.

## Fixed helpers

Only these helpers exist:

- `eq` — strict equality.
- `formatCurrency amount [currency] [locale]` — defaults to `en-US`/`USD`.
- `formatDate value [locale]` — formats in UTC; defaults to `en-US`.

Control flow is limited to `each`, `if`, `unless` and `with`. Templates cannot register helpers.
Partials and decorators are rejected at compile time. Calls to helpers outside the fixed set, such as
`log` or `lookup`, fail compilation. `buildManifest` compiles every `.html`/`.hbs` file in lenient
mode so a non-compilable template cannot enter the manifest.

## Placeholder markers

`extractPlaceholders` walks the Handlebars AST and returns a JSON-safe tree:

| Template                                                | Placeholder                        |
| ------------------------------------------------------- | ---------------------------------- |
| `{{name}}`                                              | `"string"`                         |
| `{{#each items}}`                                       | `"array"`                          |
| `{{#if active}}` / `{{#unless active}}` / `{{^active}}` | `"boolean"`                        |
| `{{#with customer}}` / `{{#customer}}`                  | `"object"`                         |
| `{{customer.name}}`                                     | `{ customer: { name: "string" } }` |

`this.x`, `./x`, `@root.x` and `../x` resolve to root keys where the current context is
unambiguous. `each` and `with` bodies are modelled coarsely: their item/object fields are not
expanded into the root tree. Trees use null-prototype objects, and the path segments `__proto__`,
`prototype` and `constructor` are rejected with `TemplateCompileError`.

## Content hash

`hashTemplateFiles` accepts a directory or an explicit file list. It computes SHA-256 over the
sorted `relative path + "\0" + bytes` sequence. Paths are relative to the directory or common root,
so moving a template tree does not change its hash. Dot files and dot directories are ignored.

## Manifest

`buildManifest(root, release = "local")` reads `<root>/templates/*/template.json`, validates each
descriptor, compiles and extracts its HTML, hashes the folder and returns:

```json
{
  "release": "v1.4.0",
  "templates": [
    {
      "id": "…",
      "slug": "generic-report",
      "name": "Generic report",
      "path": "templates/generic-report",
      "contentHash": "…",
      "placeholders": { "customer": { "name": "string" } }
    }
  ]
}
```

Templates are sorted by slug. Descriptors require a UUID v4 `id`, the reserved `_smoke` slug or a
public slug matching `^[a-z][a-z0-9-]{2,63}$`, a non-empty `name`, a non-empty `description`, and
unique ids/slugs across the manifest. The function returns the manifest; the CLI owns writing
`templates.manifest.json`.

## Checks

```bash
pnpm --filter @printer/template-engine test
pnpm --filter @printer/template-engine typecheck
pnpm lint
pnpm exec prettier --check packages/template-engine
```
