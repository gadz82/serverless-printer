import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildManifest } from "./template-manifest.mjs";

const SMOKE_ID = "72803074-1601-4a08-a5a5-49db9feacd66";
const FIRST_ID = "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11";
const SECOND_ID = "9f5d9d5e-1f0a-4b65-9d67-1b3d5f7a9c21";

const temporaryRoots = [];

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "printer-template-manifest-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTemplate(root, directory, options = {}) {
  const {
    html = '<!doctype html>\n<html lang="en"><body><p>{{message}}</p></body></html>\n',
    ...descriptorOverrides
  } = options;
  const descriptor = {
    id: FIRST_ID,
    slug: directory,
    name: `Template ${directory}`,
    description: "Test template",
    ...descriptorOverrides,
  };
  const templateDirectory = path.join(root, "templates", directory);

  await mkdir(templateDirectory, { recursive: true });
  await writeFile(
    path.join(templateDirectory, "template.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(templateDirectory, "index.html"), html, "utf8");
  await writeFile(
    path.join(templateDirectory, "sample.json"),
    '{ "message": "Printer smoke" }\n',
    "utf8",
  );

  return templateDirectory;
}

async function readManifestBytes(root) {
  return readFile(path.join(root, "templates.manifest.json"), "utf8");
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("template manifest", () => {
  it("produces identical bytes and content hashes across runs", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID, name: "Smoke test" });

    const first = await buildManifest(root, "local");
    const firstBytes = await readManifestBytes(root);
    const second = await buildManifest(root, "local");
    const secondBytes = await readManifestBytes(root);

    expect(secondBytes).toBe(firstBytes);
    expect(second).toEqual(first);
    expect(first.release).toBe("local");
    expect(first.templates).toHaveLength(1);
    expect(first.templates[0]).toMatchObject({
      id: SMOKE_ID,
      slug: "_smoke",
      name: "Smoke test",
      path: "templates/_smoke",
    });
    expect(first.templates[0].contentHash).toMatch(/^[a-f0-9]{64}$/);

    const otherRoot = await createRoot();
    await writeTemplate(otherRoot, "_smoke", { id: SMOKE_ID, name: "Smoke test" });
    const other = await buildManifest(otherRoot, "local");

    expect(other.templates[0].contentHash).toBe(first.templates[0].contentHash);
  });

  it("changes the content hash when a template file changes", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const before = await buildManifest(root, "local");
    await writeFile(
      path.join(templateDirectory, "index.html"),
      '<!doctype html>\n<html lang="en"><body><p>{{message}} changed</p></body></html>\n',
      "utf8",
    );
    const after = await buildManifest(root, "local");

    expect(after.templates[0].contentHash).not.toBe(before.templates[0].contentHash);
  });

  it("ignores dot files inside a template", async () => {
    const root = await createRoot();
    const templateDirectory = await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const before = await buildManifest(root, "local");
    const beforeBytes = await readManifestBytes(root);
    await writeFile(path.join(templateDirectory, ".DS_Store"), "ignored", "utf8");
    await mkdir(path.join(templateDirectory, ".cache"), { recursive: true });
    await writeFile(path.join(templateDirectory, ".cache", "entry"), "ignored", "utf8");
    const after = await buildManifest(root, "local");

    expect(after.templates[0].contentHash).toBe(before.templates[0].contentHash);
    expect(await readManifestBytes(root)).toBe(beforeBytes);
  });

  it("accepts the reserved _smoke slug", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const manifest = await buildManifest(root, "local");

    expect(manifest.templates[0].slug).toBe("_smoke");
  });

  it("rejects any other leading-underscore slug", async () => {
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

  it("rejects duplicate template ids", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "beta", { id: FIRST_ID, slug: "beta" });

    await expect(buildManifest(root, "local")).rejects.toThrow(
      /Duplicate template id "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11"/,
    );
  });

  it("rejects duplicate template slugs", async () => {
    const root = await createRoot();
    await writeTemplate(root, "alpha-one", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "alpha-two", { id: SECOND_ID, slug: "alpha" });

    await expect(buildManifest(root, "local")).rejects.toThrow(/Duplicate template slug "alpha"/);
  });

  it("extracts simple placeholders as string values", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", {
      id: SMOKE_ID,
      html: [
        "<!doctype html>",
        '<html lang="en">',
        "<body>",
        "<h1>{{message}}</h1>",
        "<p>{{ name }}</p>",
        "<p>{{message}}</p>",
        "</body>",
        "</html>",
      ].join("\n"),
    });

    const manifest = await buildManifest(root, "local");

    expect(manifest.templates[0].placeholders).toEqual({
      message: "string",
      name: "string",
    });
  });

  it("uses the provided release", async () => {
    const root = await createRoot();
    await writeTemplate(root, "_smoke", { id: SMOKE_ID });

    const manifest = await buildManifest(root, "v1.2.3");

    expect(manifest.release).toBe("v1.2.3");
  });
});
