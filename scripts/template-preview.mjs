import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { register } from "tsx/esm/api";

register();

// The engine and the worker renderer ship TypeScript sources, so load them
// through tsx rather than depending on a package build that does not exist.
const engineRequire = createRequire(
  new URL("../packages/template-engine/package.json", import.meta.url),
);
const engineEntry = engineRequire.resolve("./src/index.ts");
const { compileTemplate, validateTemplateDescriptor } = await import(
  pathToFileURL(engineEntry).href
);

const rendererEntry = fileURLToPath(
  new URL("../apps/render-worker/src/rendering/local-chrome-renderer.ts", import.meta.url),
);
const { LocalChromeRenderer, resolveChromeExecutable } = await import(
  pathToFileURL(rendererEntry).href
);

const TEMPLATES_DIRECTORY = "templates";
const LOCAL_DIRECTORY = ".local";
const SLUG_PATTERN = /^(?:_smoke|[a-z][a-z0-9-]{2,63})$/;
const USAGE = [
  "Usage: pnpm template:preview <slug> [--data <file>] [--strict] [--pdfa <level>]",
  "Renders the template with a locally installed Chrome and writes .local/<slug>.pdf.",
  "PDF/A output is available in Slice 2.",
].join("\n");

export class TemplatePreviewError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TemplatePreviewError";
  }
}

/**
 * Runs the template preview with the same page settings as the Lambda
 * renderer. The browser is created per call by LocalChromeRenderer.
 *
 * @param {string} root Repository root that contains `templates`.
 * @param {{ slug: string, dataPath?: string, strict?: boolean, outputDirectory?: string }} options
 * @returns {Promise<{ descriptor: { id: string, slug: string, name: string, description: string }, outputPath: string, pdf: Uint8Array }>}
 */
// ORCHID-MEM: 01a1c51f-4289-7e73-8075-584669d85127 — Renders a template locally to a PDF using the shared engine and Chrome.
export async function previewTemplate(root, options) {
  const repositoryRoot = path.resolve(root);
  const slug = readSlug(options.slug);
  const template = await loadTemplate(repositoryRoot, slug);
  const data = await readTemplateData(template.directory, template.relativePath, options.dataPath);
  const html = compileTemplate(template.source, {
    mode: options.strict === true ? "strict" : "lenient",
  })(data);

  const renderer = new LocalChromeRenderer();
  const pdf = await renderer.render({
    html,
    baseDirectory: template.directory,
  });

  const outputDirectory = options.outputDirectory ?? path.join(repositoryRoot, LOCAL_DIRECTORY);
  const outputPath = path.join(outputDirectory, `${template.descriptor.slug}.pdf`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, pdf);

  return { descriptor: template.descriptor, outputPath, pdf };
}

/**
 * Exposed so tests and callers can skip Chrome-dependent flows cleanly.
 *
 * @returns {string | undefined}
 */
export function findChromeExecutable() {
  return resolveChromeExecutable();
}

/**
 * @param {readonly string[]} argv
 * @returns {{ slug: string, dataPath?: string, strict: boolean, help: boolean }}
 */
export function parsePreviewArguments(argv) {
  if (argv.some((argument) => argument === "--pdfa" || argument.startsWith("--pdfa="))) {
    throw new TemplatePreviewError(
      "--pdfa is not available yet; PDF/A output is available in Slice 2.",
    );
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        data: { type: "string" },
        strict: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new TemplatePreviewError(`${errorMessage(error)}\n${USAGE}`, { cause: error });
  }

  if (parsed.values.help) {
    return { slug: "", dataPath: undefined, strict: false, help: true };
  }

  if (parsed.positionals.length !== 1) {
    throw new TemplatePreviewError(`A single template slug is required.\n${USAGE}`);
  }

  const slug = readSlug(parsed.positionals[0]);

  return {
    slug,
    dataPath: parsed.values.data,
    strict: parsed.values.strict,
    help: false,
  };
}

async function loadTemplate(repositoryRoot, slug) {
  const relativePath = `${TEMPLATES_DIRECTORY}/${slug}`;
  const templateDirectory = path.join(repositoryRoot, TEMPLATES_DIRECTORY, slug);
  const descriptorPath = path.join(templateDirectory, "template.json");

  let descriptorSource;
  try {
    descriptorSource = await readFile(descriptorPath, "utf8");
  } catch (error) {
    throw new TemplatePreviewError(
      `Cannot read ${relativePath}/template.json: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let parsedDescriptor;
  try {
    parsedDescriptor = JSON.parse(descriptorSource);
  } catch (error) {
    throw new TemplatePreviewError(
      `Invalid JSON in ${relativePath}/template.json: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let descriptor;
  try {
    descriptor = validateTemplateDescriptor(parsedDescriptor);
  } catch (error) {
    throw new TemplatePreviewError(
      `Invalid template descriptor in ${relativePath}/template.json: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (descriptor.slug !== slug) {
    throw new TemplatePreviewError(
      `Template folder ${relativePath} does not match its descriptor slug "${descriptor.slug}".`,
    );
  }

  let source;
  try {
    source = await readFile(path.join(templateDirectory, "index.html"), "utf8");
  } catch (error) {
    throw new TemplatePreviewError(
      `Cannot read ${relativePath}/index.html: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }

  return { descriptor, directory: templateDirectory, relativePath, source };
}

async function readTemplateData(templateDirectory, relativePath, dataPath) {
  const resolvedDataPath =
    dataPath === undefined ? path.join(templateDirectory, "sample.json") : path.resolve(dataPath);
  const label =
    dataPath === undefined ? `${relativePath}/sample.json` : `data file ${resolvedDataPath}`;

  let source;
  try {
    source = await readFile(resolvedDataPath, "utf8");
  } catch (error) {
    throw new TemplatePreviewError(`Cannot read ${label}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new TemplatePreviewError(`Invalid JSON in ${label}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  if (!isPlainObject(parsed)) {
    throw new TemplatePreviewError(`${label} must contain a JSON object.`);
  }

  return parsed;
}

function readSlug(value) {
  if (typeof value !== "string" || !SLUG_PATTERN.test(value)) {
    throw new TemplatePreviewError(
      `Invalid template slug "${String(value)}"; expected a folder name such as "generic-report".`,
    );
  }

  return value;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function displayPath(root, outputPath) {
  const relativePath = path.relative(root, outputPath);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath) ? outputPath : relativePath;
}

async function main() {
  const options = parsePreviewArguments(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const result = await previewTemplate(repositoryRoot, options);
  console.log(`Wrote ${displayPath(repositoryRoot, result.outputPath)}`);
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
