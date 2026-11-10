import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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
const { validateTemplateDescriptor } = await import(pathToFileURL(engineEntry).href);

const TEMPLATES_DIRECTORY = "templates";
const RESERVED_SMOKE_SLUG = "_smoke";
const USAGE = "Usage: pnpm template:new <slug>";

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{title}}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>{{title}}</h1>
      <p>{{message}}</p>
    </main>
  </body>
</html>
`;

const STYLES_CSS = `body {
  color: #1a1a1a;
  font-family: system-ui, sans-serif;
  margin: 3rem auto;
  max-width: 40rem;
  padding: 0 1rem;
}
`;

const SAMPLE_JSON = `{
  "title": "TODO: template title",
  "message": "TODO: replace this sample data."
}
`;

/**
 * Creates a new template folder with a fresh identity.
 *
 * @param {string} root Repository root that contains the `templates` directory.
 * @param {string} slug Slug for the new template.
 * @returns {Promise<{ directory: string, slug: string, id: string }>}
 */
export async function createTemplate(root, slug) {
  assertNewSlug(slug);

  const id = randomUUID();
  const name = nameFromSlug(slug);
  const descriptor = {
    id,
    slug,
    name,
    description: `TODO: describe the ${name} template.`,
  };

  try {
    validateTemplateDescriptor(descriptor);
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }

  const repositoryRoot = path.resolve(root);
  const templatesDirectory = path.join(repositoryRoot, TEMPLATES_DIRECTORY);
  const templateDirectory = path.join(templatesDirectory, slug);
  const relativeDirectory = `${TEMPLATES_DIRECTORY}/${slug}`;

  if (await pathExists(templateDirectory)) {
    throw new Error(
      `Template folder ${relativeDirectory} already exists. Choose a new slug or edit the existing template.`,
    );
  }

  try {
    await mkdir(templatesDirectory, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot create templates directory at ${templatesDirectory}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let createdTemplateDirectory = false;

  try {
    await mkdir(templateDirectory);
    createdTemplateDirectory = true;
    await writeFile(
      path.join(templateDirectory, "template.json"),
      `${JSON.stringify(descriptor, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(templateDirectory, "index.html"), INDEX_HTML, "utf8");
    await writeFile(path.join(templateDirectory, "styles.css"), STYLES_CSS, "utf8");
    await writeFile(path.join(templateDirectory, "sample.json"), SAMPLE_JSON, "utf8");
  } catch (error) {
    if (createdTemplateDirectory) {
      try {
        await rm(templateDirectory, { recursive: true, force: true });
      } catch {
        // Keep the original creation error; cleanup is best effort.
      }
    }

    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Template folder ${relativeDirectory} already exists. Choose a new slug or edit the existing template.`,
        { cause: error },
      );
    }

    throw new Error(`Cannot create ${relativeDirectory}: ${errorMessage(error)}`, { cause: error });
  }

  return { directory: relativeDirectory, slug, id };
}

function assertNewSlug(slug) {
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error(`A template slug is required.\n${USAGE}`);
  }

  if (slug === RESERVED_SMOKE_SLUG) {
    throw new Error(`Invalid slug "${slug}": it is reserved for smoke tests.`);
  }
}

function nameFromSlug(slug) {
  return slug
    .split("-")
    .filter((word) => word.length > 0)
    .map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isAlreadyExistsError(error) {
  return typeof error === "object" && error !== null && error.code === "EEXIST";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printUsage() {
  console.log(USAGE);
  console.log(
    "Creates templates/<slug>/ with template.json, index.html, styles.css and sample.json.",
  );
}

async function main() {
  const [slug, ...extra] = process.argv.slice(2);

  if (slug === undefined || extra.length > 0) {
    throw new Error(USAGE);
  }

  if (slug === "--help" || slug === "-h") {
    printUsage();
    return;
  }

  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const created = await createTemplate(repositoryRoot, slug);
  console.log(`Created ${created.directory} with template id ${created.id}.`);
  console.log("Next: edit the descriptor, index.html, styles.css and sample.json.");
  console.log(`Then run: pnpm template:validate`);
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
