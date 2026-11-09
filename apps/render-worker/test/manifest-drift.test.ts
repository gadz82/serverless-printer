import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../scripts/template-manifest.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COMMITTED_MANIFEST_PATH = fileURLToPath(
  new URL("../src/templates.manifest.json", import.meta.url),
);

describe("committed template manifest", () => {
  it("matches buildManifest(repository root, local)", async () => {
    const snapshotRoot = await mkdtemp(join(tmpdir(), "printer-manifest-drift-"));
    try {
      // Build from a snapshot so the drift guard never writes the root manifest.
      await cp(join(REPOSITORY_ROOT, "templates"), join(snapshotRoot, "templates"), {
        recursive: true,
      });
      const generated = await buildManifest(snapshotRoot, "local");
      const committed = JSON.parse(await readFile(COMMITTED_MANIFEST_PATH, "utf8")) as unknown;

      expect(committed).toEqual(generated);
    } finally {
      await rm(snapshotRoot, { recursive: true, force: true });
    }
  });
});
