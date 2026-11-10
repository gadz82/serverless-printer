import { spawnSync } from "node:child_process";
import { access, copyFile, cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { buildManifest } from "./template-manifest.mjs";

const MANIFEST_FILE = "templates.manifest.json";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const distDirectory = path.join(repositoryRoot, "dist");
const handlerSource = path.join(repositoryRoot, "apps/render-worker/src/handler.ts");
const handlerOutput = path.join(distDirectory, "handler.mjs");
const manifestSource = path.join(repositoryRoot, MANIFEST_FILE);
const manifestOutput = path.join(distDirectory, MANIFEST_FILE);
const templatesSource = path.join(repositoryRoot, "templates");
const templatesOutput = path.join(distDirectory, "templates");
const zipPath = path.join(distDirectory, "render-worker.zip");
const release = process.env.RELEASE || "local";

await requirePath(handlerSource, "render worker handler");
await requireDirectory(templatesSource, "templates directory");

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

const manifest = await buildManifest(repositoryRoot, release);
await requirePath(manifestSource, "generated template manifest");

if (manifest.templates.length === 0) {
  throw new Error("Template manifest is empty; expected at least the _smoke template.");
}

if (!manifest.templates.some((template) => template.slug === "_smoke")) {
  throw new Error('Template manifest does not contain the required "_smoke" template.');
}

await build({
  entryPoints: [handlerSource],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: handlerOutput,
  banner: {
    js: 'import { createRequire as __printerCreateRequire } from "node:module"; const require = __printerCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

await copyFile(manifestSource, manifestOutput);
await cp(templatesSource, templatesOutput, { recursive: true });

await requirePath(handlerOutput, "bundled handler");
await requirePath(manifestOutput, "copied template manifest");
await requireDirectory(templatesOutput, "copied templates directory");

const zip = spawnSync("zip", ["-r", "-q", "render-worker.zip", ".", "-x", "render-worker.zip"], {
  cwd: distDirectory,
  stdio: "inherit",
});

if (zip.error !== undefined) {
  throw new Error(`Could not run the zip CLI: ${zip.error.message}`, { cause: zip.error });
}

if (zip.status !== 0) {
  throw new Error(`zip exited with status ${String(zip.status)}`);
}

await requirePath(zipPath, "worker zip");

// A build that esbuild reports as successful can still produce a module
// without the Lambda export. Import the bundle so the release fails here, not
// on the first deployed invocation.
const workerModule = await import(pathToFileURL(handlerOutput).href);
if (typeof workerModule.handler !== "function") {
  throw new Error(`Bundled ${handlerOutput} does not export a handler function.`);
}

const archive = await stat(zipPath);
console.log(
  `Built dist/render-worker.zip (${archive.size} bytes) for release ${manifest.release}.`,
);

async function requirePath(filePath, description) {
  try {
    await access(filePath);
  } catch (error) {
    throw new Error(`Missing ${description} at ${filePath}.`, { cause: error });
  }
}

async function requireDirectory(directoryPath, description) {
  try {
    const details = await stat(directoryPath);
    if (!details.isDirectory()) {
      throw new Error(`${description} at ${directoryPath} is not a directory.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${description} at `)) {
      throw error;
    }
    throw new Error(`Missing ${description} at ${directoryPath}.`, { cause: error });
  }
}
