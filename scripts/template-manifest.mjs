import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MANIFEST_FILE = "templates.manifest.json";
const PUBLIC_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const RESERVED_SMOKE_SLUG = "_smoke";
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const HTML_FILE_PATTERN = /\.(?:html|hbs)$/i;

const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
}

async function describeTemplate(templateDirectory) {
  const files = await listFiles(templateDirectory);
  const hash = createHash("sha256");
  const placeholders = new Set();

  for (const file of files) {
    const bytes = await readFile(file.absolutePath);

    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(bytes);

    if (HTML_FILE_PATTERN.test(file.relativePath)) {
      for (const match of bytes.toString("utf8").matchAll(PLACEHOLDER_PATTERN)) {
        placeholders.add(match[1]);
      }
    }
  }

  return {
    contentHash: hash.digest("hex"),
    placeholders: Object.fromEntries(
      [...placeholders].sort(comparePaths).map((name) => [name, "string"]),
    ),
  };
}

function assertSlug(slug, source) {
  if (slug === RESERVED_SMOKE_SLUG) {
    return;
  }

  if (slug.startsWith("_")) {
    throw new Error(
      `Invalid slug "${slug}" in ${source}: only "${RESERVED_SMOKE_SLUG}" may start with an underscore.`,
    );
  }

  if (!PUBLIC_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid slug "${slug}" in ${source}: expected ${PUBLIC_SLUG_PATTERN}.`);
  }
}

function assertDescriptor(descriptor, source) {
  if (descriptor === null || typeof descriptor !== "object") {
    throw new Error(`Template ${source} must contain a JSON object.`);
  }

  for (const field of ["id", "slug", "name"]) {
    if (typeof descriptor[field] !== "string" || descriptor[field].length === 0) {
      throw new Error(`Template ${source} must define a non-empty string "${field}".`);
    }
  }
}

function registerUnique(seen, value, kind, source) {
  const existingSource = seen.get(value);

  if (existingSource !== undefined) {
    throw new Error(`Duplicate template ${kind} "${value}" in ${source} and ${existingSource}.`);
  }

  seen.set(value, source);
}

// ORCHID-MEM: 01a1c1d8-f4a3-73ce-8036-12b8b6325602 — Builds the release-aware template manifest with sorted SHA-256 content hashes.
export async function buildManifest(root, release = process.env.RELEASE || "local") {
  const repositoryRoot = path.resolve(root);
  const templatesDirectory = path.join(repositoryRoot, "templates");

  let entries;
  try {
    entries = await readdir(templatesDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read templates directory at ${templatesDirectory}: ${error.message}`, {
      cause: error,
    });
  }

  const templates = [];
  const ids = new Map();
  const slugs = new Map();

  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) {
      continue;
    }

    const relativePath = `templates/${entry.name}`;
    const templateJsonPath = path.join(templatesDirectory, entry.name, "template.json");

    let source;
    try {
      source = await readFile(templateJsonPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }

      throw new Error(`Cannot read ${templateJsonPath}: ${error.message}`, { cause: error });
    }

    let descriptor;
    try {
      descriptor = JSON.parse(source);
    } catch (error) {
      throw new Error(`Invalid JSON in ${templateJsonPath}: ${error.message}`, { cause: error });
    }

    assertDescriptor(descriptor, templateJsonPath);
    assertSlug(descriptor.slug, templateJsonPath);
    registerUnique(ids, descriptor.id, "id", relativePath);
    registerUnique(slugs, descriptor.slug, "slug", relativePath);

    const { contentHash, placeholders } = await describeTemplate(
      path.join(templatesDirectory, entry.name),
    );

    templates.push({
      id: descriptor.id,
      slug: descriptor.slug,
      name: descriptor.name,
      path: relativePath,
      contentHash,
      placeholders,
    });
  }

  templates.sort((left, right) => comparePaths(left.slug, right.slug));

  const manifest = { release, templates };
  await writeFile(
    path.join(repositoryRoot, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
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
  await main();
}
