import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { buildManifest } from "./template-manifest.mjs";

// ORCHID-MEM: 01a1c6e2-74b9-7f7c-b83b-72a18dc313da — Packages the worker, Chromium closure, templates, manifest and ICC into the release zip.

const MANIFEST_FILE = "templates.manifest.json";
const SPARTICUZ_PACKAGE = "@sparticuz/chromium";
const MINIMUM_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_UNZIPPED_BYTES = 240 * 1024 * 1024;
const REQUIRED_ZIP_ENTRIES = [
  "handler.mjs",
  "templates.manifest.json",
  "templates/_smoke/index.html",
  "pdfa/sRGB2014.icc",
  "node_modules/@sparticuz/chromium/package.json",
  "node_modules/@sparticuz/chromium/bin/chromium.br",
  "node_modules/@sparticuz/chromium/bin/al2023.tar.br",
  "node_modules/@sparticuz/chromium/bin/fonts.tar.br",
  "node_modules/@sparticuz/chromium/bin/swiftshader.tar.br",
  "node_modules/tar-fs/package.json",
  "node_modules/bare-fs/package.json",
  "node_modules/streamx/package.json",
];
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const distDirectory = path.join(repositoryRoot, "dist");
const handlerSource = path.join(repositoryRoot, "apps/render-worker/src/handler.ts");
const handlerOutput = path.join(distDirectory, "handler.mjs");
const manifestSource = path.join(repositoryRoot, MANIFEST_FILE);
const manifestOutput = path.join(distDirectory, MANIFEST_FILE);
const templatesSource = path.join(repositoryRoot, "templates");
const templatesOutput = path.join(distDirectory, "templates");
const iccSource = path.join(repositoryRoot, "apps/render-worker/src/pdfa/sRGB2014.icc");
const nodeModulesOutput = path.join(distDirectory, "node_modules");
const zipPath = path.join(distDirectory, "render-worker.zip");
const release = process.env.RELEASE || "local";

await requirePath(handlerSource, "render worker handler");
await requireDirectory(templatesSource, "templates directory");
await requirePath(iccSource, "sRGB ICC profile");

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
  // Chromium is a 64 MB binary package that must stay a real dependency on
  // disk: @sparticuz/chromium reads its bin/ files through require/import at
  // runtime. Puppeteer, pdf-lib and the worker code stay bundled.
  external: [SPARTICUZ_PACKAGE],
  banner: {
    js: 'import { createRequire as __printerCreateRequire } from "node:module"; const require = __printerCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

await copyFile(manifestSource, manifestOutput);
await cp(templatesSource, templatesOutput, { recursive: true });
await mkdir(path.dirname(path.join(distDirectory, "pdfa/sRGB2014.icc")), { recursive: true });
await copyFile(iccSource, path.join(distDirectory, "pdfa/sRGB2014.icc"));

const packageClosure = await collectRuntimeClosure(
  SPARTICUZ_PACKAGE,
  createRequire(path.join(repositoryRoot, "apps/render-worker/package.json")),
);
await copyRuntimeClosure(packageClosure);

await requirePath(handlerOutput, "bundled handler");
await requirePath(manifestOutput, "copied template manifest");
await requireDirectory(templatesOutput, "copied templates directory");
await requirePath(path.join(nodeModulesOutput, SPARTICUZ_PACKAGE), "packaged Chromium");

const unzippedBytes = await directorySize(distDirectory);
if (unzippedBytes > MAXIMUM_UNZIPPED_BYTES) {
  throw new Error(
    `Worker payload is ${String(unzippedBytes)} bytes before zip; Lambda allows at most ${String(MAXIMUM_UNZIPPED_BYTES)}.`,
  );
}

const zip = spawnSync(
  "zip",
  ["-r", "-q", "-X", "render-worker.zip", ".", "-x", "render-worker.zip"],
  {
    cwd: distDirectory,
    stdio: "inherit",
  },
);

if (zip.error !== undefined) {
  throw new Error(`Could not run the zip CLI: ${zip.error.message}`, { cause: zip.error });
}

if (zip.status !== 0) {
  throw new Error(`zip exited with status ${String(zip.status)}`);
}

await requirePath(zipPath, "worker zip");
await assertZipContents(zipPath, packageClosure);
await assertChromiumClosureResolves(handlerOutput);

// A build that esbuild reports as successful can still produce a module
// without the Lambda export. Import the bundle so the release fails here, not
// on the first deployed invocation.
const workerModule = await import(pathToFileURL(handlerOutput).href);
if (typeof workerModule.handler !== "function") {
  throw new Error(`Bundled ${handlerOutput} does not export a handler function.`);
}

const archive = await stat(zipPath);
if (archive.size < MINIMUM_ARCHIVE_BYTES) {
  throw new Error(
    `Worker zip is ${String(archive.size)} bytes; expected at least ${String(MINIMUM_ARCHIVE_BYTES)} with the Chromium package.`,
  );
}

console.log(
  `Built dist/render-worker.zip (${archive.size} bytes) for release ${manifest.release}; ` +
    `packaged ${String(packageClosure.size)} Chromium runtime packages.`,
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

/**
 * Resolves @sparticuz/chromium and every runtime dependency through the pnpm
 * layout, so the zip contains tar-fs and its bare-* closure as real
 * directories instead of dangling symlinks.
 *
 * @param {string} rootPackage
 * @param {NodeRequire} rootRequire
 * @returns {Promise<Map<string, string>>}
 */
async function collectRuntimeClosure(rootPackage, rootRequire) {
  const packages = new Map();
  const pending = [{ name: rootPackage, require: rootRequire }];

  while (pending.length > 0) {
    const { name, require: packageRequire } = pending.pop();
    if (packages.has(name)) {
      continue;
    }

    const packageDirectory = await resolvePackageDirectory(name, packageRequire);
    packages.set(name, packageDirectory);

    const packageJson = JSON.parse(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    );
    const dependencyRequire = createRequire(path.join(packageDirectory, "package.json"));
    const optional = new Set(Object.keys(packageJson.optionalDependencies ?? {}));

    for (const dependency of [...Object.keys(packageJson.dependencies ?? {}), ...optional]) {
      try {
        dependencyRequire.resolve(dependency);
      } catch (error) {
        if (optional.has(dependency)) {
          continue;
        }
        throw new Error(
          `Cannot resolve runtime dependency ${dependency} of ${name} from ${packageDirectory}.`,
          { cause: error },
        );
      }
      pending.push({ name: dependency, require: dependencyRequire });
    }
  }

  return packages;
}

async function resolvePackageDirectory(name, packageRequire) {
  const entry = packageRequire.resolve(name);
  let directory = path.dirname(entry);

  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, "package.json");
    try {
      const packageJson = JSON.parse(await readFile(candidate, "utf8"));
      if (packageJson.name === name) {
        return await realpath(directory);
      }
    } catch {
      // Keep walking up until the matching package.json is found.
    }
    directory = path.dirname(directory);
  }

  throw new Error(`Cannot find the package root for ${name} from ${entry}.`);
}

async function copyRuntimeClosure(packageClosure) {
  for (const [name, sourceDirectory] of packageClosure) {
    const targetDirectory = path.join(nodeModulesOutput, ...name.split("/"));
    await mkdir(path.dirname(targetDirectory), { recursive: true });
    await cp(sourceDirectory, targetDirectory, { recursive: true });
  }
}

async function assertZipContents(archivePath, packageClosure) {
  const listing = spawnSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
  if (listing.error !== undefined) {
    throw new Error(`Could not inspect the worker zip: ${listing.error.message}`, {
      cause: listing.error,
    });
  }
  if (listing.status !== 0) {
    throw new Error(`unzip exited with status ${String(listing.status)}`);
  }

  const entries = new Set(listing.stdout.split(/\r?\n/u).filter((entry) => entry.length > 0));
  const closureEntries = [...packageClosure.keys()].map(
    (name) => `node_modules/${name}/package.json`,
  );
  const missing = [...REQUIRED_ZIP_ENTRIES, ...closureEntries].filter(
    (entry) => !entries.has(entry),
  );
  if (missing.length > 0) {
    throw new Error(`Worker zip is missing required entries: ${missing.join(", ")}`);
  }
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

async function assertChromiumClosureResolves(bundlePath) {
  const distRequire = createRequire(bundlePath);
  const chromiumEntry = distRequire.resolve(SPARTICUZ_PACKAGE);
  // Importing the package evaluates lambdafs, which imports tar-fs and the
  // bare-* closure immediately; a missing packaged dependency fails here.
  await import(pathToFileURL(chromiumEntry).href);
}
