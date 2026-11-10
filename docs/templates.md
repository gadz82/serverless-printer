# Templates

Templates are static HTML/Handlebars folders in the repository. They are validated in CI, bundled
into the worker and listed in the release manifest. There is no runtime template upload, template
editor or versioning: a template is its folder, and Git history is the history.

## Layout

```text
templates/
├── generic-report/
│   ├── template.json      # identity (stable UUID, slug, name, description)
│   ├── index.html         # Handlebars template
│   ├── styles.css         # print CSS
│   ├── sample.json        # sample data for validation/preview
│   ├── fonts/…            # optional .ttf/.otf/.woff/.woff2
│   └── assets/…           # optional images
└── _smoke/                # release-smoke template
```

## Identity

- `id` is a UUID v4 generated once by `pnpm template:new`; it never changes.
- `slug` is unique and immutable, matching `^[a-z][a-z0-9-]{2,63}$`, and cannot look like a UUID;
  a job's `templateId` can hold either.
- A folder's `template.json` slug must match the folder name.
- Editing a template changes the next deployment's output; there are no template versions or
  statuses.
- Removing a template makes queued jobs fail with `TEMPLATE_NOT_FOUND`.

## Handlebars

Templates use Handlebars with a fixed helper set: `eq`, `formatCurrency`, `formatDate`, plus the
built-in `each`, `if`, `unless` and `with` blocks. Custom helpers, partials and decorators are
rejected. Prototype access stays disabled.

Missing-field behavior follows `HANDLEBARS_MODE`:

| Mode                | Behavior                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `lenient` (default) | Missing fields render as empty strings                                         |
| `strict`            | Any missing field fails the job; send optional fields as `null`/`false`        |
| `assume-objects`    | Fails only when a parent object is missing, e.g. `customer` in `customer.name` |

Payload values always go through `{{ }}`, which escapes HTML.

## Placeholder schema

The tooling reads the Handlebars AST and stores a JSON placeholder tree in the manifest so callers
can see the expected payload:

| Handlebars                    | Becomes    |
| ----------------------------- | ---------- |
| `{{#each x}}`                 | array      |
| `{{#if x}}` / `{{#unless x}}` | boolean    |
| `{{#with x}}`                 | object     |
| `{{a.b}}`                     | nested key |

## Tooling

```bash
pnpm template:new invoice
pnpm template:validate
pnpm template:check --base origin/main
pnpm template:preview invoice
pnpm template:preview invoice --pdfa PDF/A-2b
pnpm template:manifest
```

| Command                                  | Purpose                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `template:new <slug>`                    | Creates a folder, descriptor and starter HTML/CSS/sample; refuses existing and `_smoke` slugs |
| `template:validate`                      | Descriptor schema, unique ids/slugs, Handlebars compilation, sample data and font warnings    |
| `template:check --base <ref>`            | Git guard for changed ids/slugs, moved folders and slug reuse                                 |
| `template:preview <slug>`                | Renders with installed Chrome; writes `.local/<slug>.pdf`                                     |
| `template:preview <slug> --pdfa <level>` | Applies the same pdf-lib archiver; writes `.local/<slug>-pdfa.pdf`                            |
| `template:manifest`                      | Writes `templates.manifest.json` for `RELEASE` (or `local`)                                   |

`--data <file>` overrides `sample.json`; `--strict` requires every referenced value. Preview
requires a local Chrome/Chromium or `CHROME_PATH`.

## Manifest

`templates.manifest.json` records the release and, for every template:

- `id`, `slug`, `name` and path inside the bundle;
- `contentHash`, a SHA-256 over the sorted files;
- `placeholders`.

The worker resolves ids/slugs from this manifest alone. The release workflow attaches the manifest
to each SemVer GitHub Release, so callers can discover templates and payload shapes.

## Fonts and accessibility

Keep every resource inside the template folder. Load fonts through `@font-face` from `fonts/`;
`template:validate` warns about CSS families that are neither bundled nor generic/system aliases.
For accessible PDF/A levels, use semantic HTML, `lang` on `<html>` and `alt` on images. The
renderer enables tagged output, but PDF/A conformance remains best effort.
