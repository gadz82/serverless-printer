import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type TemplateManifest,
  type TemplateManifestEntry,
  buildManifest,
  hashTemplateFiles,
} from "../src/index.js";

const SMOKE_ID = "72803074-1601-4a08-a5a5-49db9feacd66";
const FIRST_ID = "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11";
const SECOND_ID = "9f5d9d5e-1f0a-4b65-9d67-1b3d5f7a9c21";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "printer-template-manifest-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTemplate(
  root: string,
  directory: string,
  overrides: Record<string, unknown> = {},
  html = "<p>{{message}}</p>",
): Promise<string> {
  const templateDirectory = path.join(root, "templates", directory);
  const descriptor = {
    id: FIRST_ID,
    slug: directory,
    name: `Template ${directory}`,
    description: "Test template",
    ...overrides,
  };

  await mkdir(templateDirectory, { recursive: true });
  await writeFile(
    path.join(templateDirectory, "template.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(templateDirectory, "index.html"), html, "utf8");
  await writeFile(path.join(templateDirectory, "sample.json"), "{}\n", "utf8");

  return templateDirectory;
}

function findEntry(manifest: TemplateManifest, slug: string): TemplateManifestEntry {
  const entry = manifest.templates.find((candidate) => candidate.slug === slug);
  if (entry === undefined) {
    throw new Error(`manifest is missing template "${slug}"`);
  }

  return entry;
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildManifest", () => {
  it("builds the release-aware manifest shape in deterministic slug order", async () => {
    const root = await createRoot();
    await writeTemplate(root, "zeta", { id: FIRST_ID });
    await writeTemplate(root, "_smoke", { id: SMOKE_ID, name: "Smoke test" });
    await writeTemplate(root, "alpha", { id: SECOND_ID });

    const manifest = await buildManifest(root, "v1.2.3");
    const smoke = findEntry(manifest, "_smoke");

    expect(manifest.release).toBe("v1.2.3");
    expect(manifest.templates.map((entry) => entry.slug)).toEqual(["_smoke", "alpha", "zeta"]);
    expect(Object.keys(smoke).sort()).toEqual([
      "contentHash",
      "id",
      "name",
      "path",
      "placeholders",
      "slug",
    ]);
    expect(smoke).toMatchObject({
      id: SMOKE_ID,
      slug: "_smoke",
      name: "Smoke test",
      path: "templates/_smoke",
      placeholders: { message: "string" },
    });
    expect(smoke.contentHash).toBe(await hashTemplateFiles(path.join(root, "templates", "_smoke")));
  });

  it("produces identical manifests across runs", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID });
    await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const first = await buildManifest(root, "local");
    const firstBytes = JSON.stringify(first);
    const second = await buildManifest(root, "local");

    expect(JSON.stringify(second)).toBe(firstBytes);
    expect(second).toEqual(first);
  });

  it("changes the content hash when a template file changes", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const before = await buildManifest(root, "local");
    await writeFile(
      path.join(templateDirectory, "index.html"),
      "<p>{{message}} changed</p>",
      "utf8",
    );
    const after = await buildManifest(root, "local");

    expect(findEntry(after, "_smoke").contentHash).not.toBe(
      findEntry(before, "_smoke").contentHash,
    );
  });

  it("extracts placeholders from every HTML and Handlebars file", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(
      root,
      "_smoke",
      { id: SMOKE_ID },
      [
        "{{customer.name}}",
        "{{#each items}}{{label}}{{/each}}",
        "{{#with metadata}}{{value}}{{/with}}",
      ].join("\n"),
    );
    await writeFile(
      path.join(templateDirectory, "details.hbs"),
      "{{#if active}}{{status}}{{/if}}\n",
      "utf8",
    );

    const manifest = await buildManifest(root, "local");

    expect(findEntry(manifest, "_smoke").placeholders).toEqual({
      active: "boolean",
      customer: { name: "string" },
      items: "array",
      metadata: "object",
      status: "string",
    });
  });

  it("rejects invalid descriptors and duplicate identities", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_internal", { id: FIRST_ID, slug: "_internal" });

    await expect(buildManifest(root, "local")).rejects.toThrow(
      /only "_smoke" may start with an underscore/,
    );
  });

  it("rejects an invalid public slug", async () => {
    const root = await createRoot();
    await writeTemplate(root, "Bad_Slug", { id: FIRST_ID, slug: "Bad_Slug" });

    await expect(buildManifest(root, "local")).rejects.toThrow(/Invalid slug "Bad_Slug"/);
  });

  it("rejects a descriptor without a name", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, name: undefined });

    await expect(buildManifest(root, "local")).rejects.toThrow(/non-empty string "name"/);
  });

  it("rejects a descriptor without a description", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, description: undefined });

    await expect(buildManifest(root, "local")).rejects.toThrow(/non-empty string "description"/);
  });

  it("rejects a non-UUID template id", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: "not-a-uuid" });

    await expect(buildManifest(root, "local")).rejects.toThrow(/UUID v4/);
  });

  it("rejects a template that does not compile", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID }, "{{shout message}}");

    await expect(buildManifest(root, "local")).rejects.toThrow(
      /Invalid Handlebars in .*unknown template helper "shout"/,
    );
  });

  it("rejects a template with a partial", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(root, "_smoke", { id: SMOKE_ID });
    await writeFile(path.join(templateDirectory, "details.hbs"), "{{> header}}\n", "utf8");

    await expect(buildManifest(root, "local")).rejects.toThrow(/partials are not supported/);
  });

  it("rejects duplicate template ids", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "beta", { id: FIRST_ID, slug: "beta" });

    await expect(buildManifest(root, "local")).rejects.toThrow(
      new RegExp(`Duplicate template id "${FIRST_ID}"`),
    );
  });

  it("rejects duplicate template slugs", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha-one", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "alpha-two", { id: SECOND_ID, slug: "alpha" });

    await expect(buildManifest(root, "local")).rejects.toThrow(/Duplicate template slug "alpha"/);
  });

  it("rejects malformed template JSON", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(root, "_smoke", { id: SMOKE_ID });
    await writeFile(path.join(templateDirectory, "template.json"), "{", "utf8");

    await expect(buildManifest(root, "local")).rejects.toThrow(/Invalid JSON in .*template\.json/);
  });

  it("rejects an empty release", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    await expect(buildManifest(root, " ")).rejects.toThrow(/release must be a non-empty string/);
  });

  it("skips dot directories and folders without a descriptor", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID });
    await writeTemplate(root, ".hidden", { id: FIRST_ID, slug: "hidden" });
    await mkdir(path.join(root, "templates", "assets"), { recursive: true });
    await writeFile(path.join(root, "templates", "assets", "logo.png"), "asset", "utf8");

    const manifest = await buildManifest(root, "local");

    expect(manifest.templates.map((entry) => entry.slug)).toEqual(["_smoke"]);
  });
});
