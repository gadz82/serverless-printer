import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTemplate } from "./template-new.mjs";
import { validateTemplates } from "./template-validate.mjs";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const temporaryRoots = [];

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "printer-template-new-"));
  temporaryRoots.push(root);
  return root;
}

async function readDescriptor(root, slug) {
  const source = await readFile(path.join(root, "templates", slug, "template.json"), "utf8");
  return JSON.parse(source);
}

async function expectMissing(target) {
  await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("template:new", () => {
  it("creates a valid template folder with a fresh UUID v4", async () => {
    const root = await createRoot();

    const created = await createTemplate(root, "annual-statement");
    const descriptor = await readDescriptor(root, "annual-statement");

    expect(created).toEqual({
      directory: "templates/annual-statement",
      slug: "annual-statement",
      id: descriptor.id,
    });
    expect(descriptor.id).toMatch(UUID_V4_PATTERN);
    expect(descriptor.slug).toBe("annual-statement");
    expect(descriptor.name).toBe("Annual statement");
    expect(descriptor.description.length).toBeGreaterThan(0);

    for (const file of ["template.json", "index.html", "styles.css", "sample.json"]) {
      const stats = await stat(path.join(root, "templates", "annual-statement", file));
      expect(stats.isFile()).toBe(true);
    }

    const report = await validateTemplates(root);
    expect(report.ok).toBe(true);
    expect(report.templates).toHaveLength(1);
    expect(report.templates[0]).toMatchObject({ template: "annual-statement", ok: true });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("uses a different UUID for every template", async () => {
    const root = await createRoot();

    await createTemplate(root, "first-report");
    await createTemplate(root, "second-report");

    const first = await readDescriptor(root, "first-report");
    const second = await readDescriptor(root, "second-report");

    expect(first.id).not.toBe(second.id);
  });

  it("refuses to overwrite an existing template folder", async () => {
    const root = await createRoot();
    await createTemplate(root, "annual-statement");
    const before = await readDescriptor(root, "annual-statement");

    await expect(createTemplate(root, "annual-statement")).rejects.toThrow(/already exists/);

    const after = await readDescriptor(root, "annual-statement");
    expect(after.id).toBe(before.id);
  });

  it("rejects invalid and reserved slugs without creating a folder", async () => {
    const root = await createRoot();

    for (const slug of ["Bad_Slug", "../escape", "ab", "_smoke"]) {
      await expect(createTemplate(root, slug)).rejects.toThrow(
        /Invalid slug|reserved for smoke tests/,
      );
    }

    await expectMissing(path.join(root, "templates"));
  });
});
