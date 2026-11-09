import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ManifestError,
  ManifestTemplateCatalog,
  parseTemplateManifest,
} from "../src/adapters/manifest-template-catalog.js";

const TEMPLATE_ID = "72803074-1601-4a08-a5a5-49db9feacd66";
const CONTENT_HASH = "0471e548d4a26d54937f991e68b03756f5651215865176bbba3cf996db7ede51";

const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TEMPLATE_ID,
  slug: "_smoke",
  name: "Smoke test",
  path: "templates/_smoke",
  contentHash: CONTENT_HASH,
  placeholders: { message: "string" },
  ...overrides,
});

const manifestDocument = (templates: readonly unknown[] = [entry()]): unknown => ({
  release: "v1.2.3",
  templates,
});

async function withManifestPath(
  value: unknown,
  run: (manifestPath: string) => Promise<void>,
  serialize: (value: unknown) => string = (document) => JSON.stringify(document),
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "printer-manifest-"));
  const manifestPath = join(directory, "templates.manifest.json");
  try {
    await writeFile(manifestPath, serialize(value), "utf8");
    await run(manifestPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withCatalog(
  value: unknown,
  run: (catalog: ManifestTemplateCatalog) => Promise<void>,
  serialize: (value: unknown) => string = (document) => JSON.stringify(document),
): Promise<void> {
  await withManifestPath(
    value,
    async (manifestPath) => {
      await run(new ManifestTemplateCatalog(manifestPath));
    },
    serialize,
  );
}

describe("ManifestTemplateCatalog", () => {
  it("resolves a template by exact id and by slug", async () => {
    await withCatalog(manifestDocument(), async (catalog) => {
      await expect(catalog.resolve(TEMPLATE_ID)).resolves.toEqual({
        id: TEMPLATE_ID,
        slug: "_smoke",
        contentHash: CONTENT_HASH,
        release: "v1.2.3",
        bundlePath: "templates/_smoke",
      });
      await expect(catalog.resolve("_smoke")).resolves.toEqual({
        id: TEMPLATE_ID,
        slug: "_smoke",
        contentHash: CONTENT_HASH,
        release: "v1.2.3",
        bundlePath: "templates/_smoke",
      });
    });
  });

  it("returns null for an unknown template", async () => {
    await withCatalog(manifestDocument(), async (catalog) => {
      await expect(catalog.resolve("unknown-template")).resolves.toBeNull();
    });
  });

  it("resolves _smoke from the bundled manifest", async () => {
    const bundledManifest = fileURLToPath(
      new URL("../src/templates.manifest.json", import.meta.url),
    );
    const catalog = new ManifestTemplateCatalog(bundledManifest);

    await expect(catalog.resolve("_smoke")).resolves.toMatchObject({
      id: TEMPLATE_ID,
      slug: "_smoke",
      release: "local",
      bundlePath: "templates/_smoke",
    });
  });

  it("rejects a manifest with an invalid shape", () => {
    expect(() => parseTemplateManifest(null)).toThrow(/manifest must be an object/);
    expect(() => parseTemplateManifest({ templates: [] })).toThrow(/manifest.release/);
    expect(() => parseTemplateManifest({ release: "local", templates: {} })).toThrow(
      /manifest.templates must be an array/,
    );
    expect(() =>
      parseTemplateManifest({ release: "local", templates: [entry({ id: undefined })] }),
    ).toThrow(/templates\[0\]\.id/);
    expect(() =>
      parseTemplateManifest({ release: "local", templates: [entry({ contentHash: "abc" })] }),
    ).toThrow(/contentHash/);
  });

  it("rejects duplicate ids and slugs", () => {
    expect(() =>
      parseTemplateManifest(manifestDocument([entry(), entry({ slug: "another-template" })])),
    ).toThrow(/duplicate template id/);
    expect(() =>
      parseTemplateManifest(
        manifestDocument([entry(), entry({ id: "a5d9c1e2-3f4b-4c6d-8e7f-9a0b1c2d3e4f" })]),
      ),
    ).toThrow(/duplicate template slug/);
  });

  it("allows _smoke but rejects another leading underscore", () => {
    expect(() => parseTemplateManifest(manifestDocument([entry({ slug: "_internal" })]))).toThrow(
      ManifestError,
    );
    expect(() => parseTemplateManifest(manifestDocument([entry({ slug: "Bad-Slug" })]))).toThrow(
      ManifestError,
    );
  });

  it("fails the constructor when the manifest is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printer-manifest-"));
    try {
      const manifestPath = join(directory, "missing.json");
      expect(() => new ManifestTemplateCatalog(manifestPath)).toThrow(
        new RegExp(`cannot read template manifest at .*missing\\.json`),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails the constructor when the manifest shape is invalid", async () => {
    await withManifestPath({}, async (manifestPath) => {
      let thrown: unknown;
      try {
        new ManifestTemplateCatalog(manifestPath);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ManifestError);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(manifestPath);
      expect(message).toContain("manifest.release");
    });
  });

  it("reports malformed JSON with the manifest path and no content", async () => {
    await withManifestPath(
      {},
      async (manifestPath) => {
        let thrown: unknown;
        try {
          new ManifestTemplateCatalog(manifestPath);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(ManifestError);
        const message = thrown instanceof Error ? thrown.message : "";
        expect(message).toContain(manifestPath);
        expect(message).toContain("is not valid JSON");
        expect(message).not.toContain("super-secret-content");
      },
      () => '{"secret":"super-secret-content",',
    );
  });
});
