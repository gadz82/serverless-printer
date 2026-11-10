import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { validateTemplates } from "./template-validate.mjs";

const FIRST_ID = "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11";
const SECOND_ID = "9f5d9d5e-1f0a-4b65-9d67-1b3d5f7a9c21";

const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <body>
    <h1>{{title}}</h1>
  </body>
</html>
`;

const DEFAULT_CSS = "body {\n  font-family: system-ui, sans-serif;\n}\n";

const temporaryRoots = [];

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "printer-template-validate-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTemplate(root, directory, options = {}) {
  const {
    id = FIRST_ID,
    slug = directory,
    name = `Template ${directory}`,
    description = "Test template",
    html = DEFAULT_HTML,
    sample = { title: "Report" },
    css = DEFAULT_CSS,
    fonts = [],
    includeSample = true,
    includeCss = true,
  } = options;
  const templateDirectory = path.join(root, "templates", directory);

  await mkdir(templateDirectory, { recursive: true });
  await writeFile(
    path.join(templateDirectory, "template.json"),
    `${JSON.stringify({ id, slug, name, description }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(templateDirectory, "index.html"), html, "utf8");

  if (includeSample) {
    await writeFile(
      path.join(templateDirectory, "sample.json"),
      `${JSON.stringify(sample, null, 2)}\n`,
      "utf8",
    );
  }

  if (includeCss) {
    await writeFile(path.join(templateDirectory, "styles.css"), css, "utf8");
  }

  for (const font of fonts) {
    const fontPath = path.join(templateDirectory, font);
    await mkdir(path.dirname(fontPath), { recursive: true });
    await writeFile(fontPath, "font-bytes", "utf8");
  }

  return templateDirectory;
}

function allErrors(report) {
  return [...report.errors, ...report.templates.flatMap((template) => template.errors)].join("\n");
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("template:validate", () => {
  it("accepts the shipped _smoke template", async () => {
    const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
    const report = await validateTemplates(repositoryRoot);
    const smoke = report.templates.find((template) => template.template === "_smoke");

    expect(report.ok).toBe(true);
    expect(smoke).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  it("accepts nested placeholders, arrays and booleans", async () => {
    const root = await createRoot();
    await writeTemplate(root, "generic-report", {
      html: [
        "<!doctype html>",
        '<html lang="en">',
        "<body>",
        "<h1>{{customer.name}}</h1>",
        "{{#each items}}<p>{{description}}</p>{{/each}}",
        "{{#if paid}}<p>Paid</p>{{else}}<p>Open</p>{{/if}}",
        "</body>",
        "</html>",
      ].join("\n"),
      sample: {
        customer: { name: "Acme" },
        items: [{ description: "Item" }],
        paid: true,
      },
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(true);
    expect(report.templates[0]).toMatchObject({ template: "generic-report", ok: true });
    expect(report.warnings).toEqual([]);
  });

  it("rejects duplicate ids on every affected template", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "beta", { id: FIRST_ID, slug: "beta" });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /Duplicate template id "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11"/,
    );
    expect(report.templates.every((template) => !template.ok)).toBe(true);
  });

  it("rejects duplicate slugs", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "beta", { id: SECOND_ID, slug: "alpha" });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(/Duplicate template slug "alpha"/);
  });

  it("rejects Handlebars compilation errors", async () => {
    const root = await createRoot();
    await writeTemplate(root, "broken", {
      html: "<!doctype html>\n<html><body>{{#each items}}</body></html>\n",
      sample: { items: [] },
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(/Invalid Handlebars/);
  });

  it("rejects a sample missing a parent object", async () => {
    const root = await createRoot();
    await writeTemplate(root, "missing-parent", {
      html: "<!doctype html>\n<html><body>{{customer.name}}</body></html>\n",
      sample: {},
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /sample\.json does not satisfy the template: template data is missing "customer"/,
    );
  });

  it("allows optional nested leaf fields inside with and each", async () => {
    const root = await createRoot();
    await writeTemplate(root, "optional-fields", {
      html: [
        "<!doctype html>",
        '<html lang="en">',
        "<body>",
        "{{#with customer}}",
        "<h1>{{name}}</h1>",
        "<p>{{nickname}}</p>",
        "{{#if vip}}<p>VIP</p>{{/if}}",
        "{{/with}}",
        "{{#each items}}",
        "<p>{{description}}</p>",
        "<p>{{note}}</p>",
        "{{#if featured}}<p>Featured</p>{{/if}}",
        "{{/each}}",
        "<p>{{company.address.city}}</p>",
        "</body>",
        "</html>",
      ].join("\n"),
      sample: {
        customer: { name: "Acme" },
        items: [{ description: "Item" }],
        company: { address: {} },
      },
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(true);
    expect(report.templates[0]).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects a sample with the wrong placeholder type", async () => {
    const root = await createRoot();
    await writeTemplate(root, "wrong-type", {
      html: "<!doctype html>\n<html><body>{{#each items}}{{label}}{{/each}}</body></html>\n",
      sample: { items: "not-an-array" },
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /sample\.json does not satisfy the template: template data "items" must be an array/,
    );
  });

  it("warns about an unbundled font without failing", async () => {
    const root = await createRoot();
    await writeTemplate(root, "custom-font", {
      css: 'body {\n  font-family: "Inter", sans-serif;\n}\n',
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/font-family "Inter" is not bundled/);
    expect(report.templates[0].warnings).toHaveLength(1);
  });

  it("does not warn when the font is bundled in fonts/", async () => {
    const root = await createRoot();
    await writeTemplate(root, "custom-font", {
      css: 'body {\n  font-family: "Inter", sans-serif;\n}\n',
      fonts: ["fonts/Inter-Regular.woff2"],
    });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("rejects an id that is not a UUID v4", async () => {
    const root = await createRoot();
    await writeTemplate(root, "bad-id", { id: "not-a-uuid" });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(/must be a UUID v4/);
  });

  it("requires sample.json", async () => {
    const root = await createRoot();
    await writeTemplate(root, "no-sample", { includeSample: false });

    const report = await validateTemplates(root);

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(/sample\.json is missing/);
  });
});
