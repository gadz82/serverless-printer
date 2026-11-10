import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

register();

// The engine ships TypeScript sources, so load its entry through tsx rather
// than depending on a package build that does not exist at release time.
const engineRequire = createRequire(
  new URL("../packages/template-engine/package.json", import.meta.url),
);
const engineEntry = engineRequire.resolve("./src/index.ts");
const { buildManifest: buildEngineManifest } = await import(pathToFileURL(engineEntry).href);

const MANIFEST_FILE = "templates.manifest.json";

/**
 * @typedef {{ id: string, slug: string, name: string, path: string, contentHash: string, placeholders: Record<string, unknown> }} TemplateManifestEntry
 * @typedef {{ release: string, templates: TemplateManifestEntry[] }} TemplateManifest
 */

// ORCHID-MEM: 01a1c1d8-f4a3-73ce-8036-12b8b6325602 — Builds the release-aware template manifest with sorted SHA-256 content hashes.
/**
 * Builds the release-aware manifest with the shared engine and writes it to
 * `<root>/templates.manifest.json`.
 *
 * @param {string} root Repository root that contains the `templates` directory.
 * @param {string} [release] Release name; defaults to `RELEASE` or `local`.
 * @returns {Promise<TemplateManifest>} The engine manifest that was written.
 */
export async function buildManifest(root, release = process.env.RELEASE || "local") {
  const repositoryRoot = path.resolve(root);
  const manifest = await buildEngineManifest(repositoryRoot, release);

  await writeFile(
    path.join(repositoryRoot, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const release = process.env.RELEASE || "local";
  const manifest = await buildManifest(repositoryRoot, release);

  console.log(
    `Wrote ${MANIFEST_FILE} with ${manifest.templates.length} template(s) for release ${manifest.release}.`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
