import { readdir, readFile } from "node:fs/promises";
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
const { compileTemplate, validateTemplateDescriptor } = await import(
  pathToFileURL(engineEntry).href
);

const TEMPLATES_DIRECTORY = "templates";
const HTML_FILE_PATTERN = /\.(?:html|hbs)$/i;
const CSS_FILE_PATTERN = /\.css$/i;
const FONT_FILE_PATTERN = /\.(?:ttf|otf|woff2?)$/i;
const FONT_FACE_PATTERN = /@font-face\s*\{([\s\S]*?)\}/gi;
const FONT_FAMILY_PATTERN = /font-family\s*:\s*([^;}]+)/gi;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTRIBUTE_PATTERN = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

const FONT_STYLE_TOKENS = new Set([
  "thin",
  "extralight",
  "ultralight",
  "light",
  "regular",
  "book",
  "normal",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "ultrabold",
  "black",
  "heavy",
  "italic",
  "oblique",
  "condensed",
  "expanded",
  "narrow",
  "wide",
  "variable",
  "variablefont",
  "vf",
]);

const FONT_STYLE_SUFFIX_PATTERN =
  /(?:ExtraLight|UltraLight|SemiBold|DemiBold|ExtraBold|UltraBold|VariableFont|Thin|Light|Regular|Book|Normal|Medium|Bold|Black|Heavy|Italic|Oblique|Condensed|Expanded|Narrow|Wide|Variable)$/i;

// Only CSS generic families, CSS-wide keywords and the standard system UI
// aliases are guaranteed without a bundled font file. Named families such as
// Arial or Roboto must be shipped under the template's fonts/ directory.
const DEFAULT_FONT_FAMILIES = new Set([
  "serif",
  "sansserif",
  "monospace",
  "cursive",
  "fantasy",
  "systemui",
  "uiserif",
  "uisansserif",
  "uimonospace",
  "uirounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revertlayer",
  "applesystem",
  "blinkmacsystemfont",
]);

/**
 * @typedef {{ template: string, ok: boolean, errors: string[], warnings: string[] }} TemplateResult
 * @typedef {{ ok: boolean, templates: TemplateResult[], errors: string[], warnings: string[] }} ValidationReport
 */

/**
 * Validates every directory under `<root>/templates`.
 *
 * @param {string} root Repository root that contains the `templates` directory.
 * @returns {Promise<ValidationReport>}
 */
// ORCHID-MEM: 01a1c51f-4183-76ad-b5fd-a13d1ce22f96 — Validates every template descriptor, compilation, sample data and font warnings.
export async function validateTemplates(root) {
  const repositoryRoot = path.resolve(root);
  const templatesDirectory = path.join(repositoryRoot, TEMPLATES_DIRECTORY);
  /** @type {ValidationReport} */
  const report = { ok: false, templates: [], errors: [], warnings: [] };

  let entries;
  try {
    entries = await readdir(templatesDirectory, { withFileTypes: true });
  } catch (error) {
    report.errors.push(
      `Cannot read templates directory at ${templatesDirectory}: ${errorMessage(error)}`,
    );
    return report;
  }

  const directories = entries
    .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory())
    .sort((left, right) => compareNames(left.name, right.name));
  const idOwners = new Map();
  const slugOwners = new Map();

  for (const entry of directories) {
    /** @type {TemplateResult} */
    const result = { template: entry.name, ok: true, errors: [], warnings: [] };
    report.templates.push(result);

    try {
      await validateTemplate(repositoryRoot, entry.name, result, idOwners, slugOwners);
    } catch (error) {
      result.errors.push(errorMessage(error));
    }
  }

  for (const result of report.templates) {
    result.ok = result.errors.length === 0;
    report.warnings.push(...result.warnings);
  }

  report.ok = report.errors.length === 0 && report.templates.every((template) => template.ok);

  return report;
}

async function validateTemplate(repositoryRoot, name, result, idOwners, slugOwners) {
  const relativePath = `${TEMPLATES_DIRECTORY}/${name}`;
  const templateDirectory = path.join(repositoryRoot, TEMPLATES_DIRECTORY, name);
  const files = await listFiles(templateDirectory);
  const descriptor = await readDescriptor(templateDirectory, relativePath, result);

  if (descriptor !== undefined) {
    if (descriptor.slug !== name) {
      result.errors.push(
        `Folder "${relativePath}" must match its descriptor slug "${descriptor.slug}".`,
      );
    }

    registerUnique(idOwners, descriptor.id, "id", relativePath, result);
    registerUnique(slugOwners, descriptor.slug, "slug", relativePath, result);
  }

  const htmlFiles = files.filter((file) => HTML_FILE_PATTERN.test(file.relativePath));
  if (htmlFiles.length === 0) {
    result.errors.push(`${relativePath} must contain at least one .html or .hbs file.`);
  }

  const compiledTemplates = [];
  for (const file of htmlFiles) {
    const label = `${relativePath}/${file.relativePath}`;
    let source;
    try {
      source = await readFile(file.absolutePath, "utf8");
    } catch (error) {
      result.errors.push(`Cannot read ${label}: ${errorMessage(error)}`);
      continue;
    }

    try {
      compileTemplate(source, { mode: "lenient" });
      compiledTemplates.push({ label, source });
    } catch (error) {
      result.errors.push(`Invalid Handlebars in ${label}: ${errorMessage(error)}`);
    }
  }

  const sample = await readSample(templateDirectory, relativePath, result);
  if (sample !== undefined) {
    validateSampleAgainstTemplates(compiledTemplates, sample, result);
  }

  await collectFontWarnings(templateDirectory, relativePath, files, result);
}

async function readDescriptor(templateDirectory, relativePath, result) {
  const descriptorPath = path.join(templateDirectory, "template.json");
  let source;
  try {
    source = await readFile(descriptorPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      result.errors.push(`${relativePath}/template.json is missing.`);
    } else {
      result.errors.push(`Cannot read ${relativePath}/template.json: ${errorMessage(error)}`);
    }
    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    result.errors.push(`Invalid JSON in ${relativePath}/template.json: ${errorMessage(error)}`);
    return undefined;
  }

  try {
    return validateTemplateDescriptor(parsed);
  } catch (error) {
    result.errors.push(
      `Invalid template descriptor in ${relativePath}/template.json: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

async function readSample(templateDirectory, relativePath, result) {
  const samplePath = path.join(templateDirectory, "sample.json");
  let source;
  try {
    source = await readFile(samplePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      result.errors.push(`${relativePath}/sample.json is missing.`);
    } else {
      result.errors.push(`Cannot read ${relativePath}/sample.json: ${errorMessage(error)}`);
    }
    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    result.errors.push(`Invalid JSON in ${relativePath}/sample.json: ${errorMessage(error)}`);
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    result.errors.push(`${relativePath}/sample.json must contain a JSON object.`);
    return undefined;
  }

  return parsed;
}

function validateSampleAgainstTemplates(compiledTemplates, sample, result) {
  for (const template of compiledTemplates) {
    try {
      // assume-objects keeps object/array structure mandatory while treating
      // leaves and if/unless booleans as optional sample data.
      compileTemplate(template.source, { mode: "assume-objects" })(sample);
    } catch (error) {
      result.errors.push(
        `${template.label}: sample.json does not satisfy the template: ${errorMessage(error)}`,
      );
    }
  }
}

async function collectFontWarnings(templateDirectory, relativePath, files, result) {
  const fontFiles = files.filter(
    (file) => file.relativePath.startsWith("fonts/") && FONT_FILE_PATTERN.test(file.relativePath),
  );
  const bundledFonts = collectBundledFontKeys(fontFiles);
  const styleSources = [];

  for (const file of files) {
    if (CSS_FILE_PATTERN.test(file.relativePath)) {
      styleSources.push({
        label: `${relativePath}/${file.relativePath}`,
        text: await readFile(file.absolutePath, "utf8"),
      });
      continue;
    }

    if (!HTML_FILE_PATTERN.test(file.relativePath)) {
      continue;
    }

    const html = await readFile(file.absolutePath, "utf8");
    for (const match of html.matchAll(STYLE_BLOCK_PATTERN)) {
      styleSources.push({
        label: `${relativePath}/${file.relativePath} (inline style)`,
        text: match[1] ?? "",
      });
    }

    for (const match of html.matchAll(STYLE_ATTRIBUTE_PATTERN)) {
      styleSources.push({
        label: `${relativePath}/${file.relativePath} (style attribute)`,
        text: match[2] ?? "",
      });
    }
  }

  for (const source of styleSources) {
    for (const match of source.text.matchAll(FONT_FACE_PATTERN)) {
      const block = match[1] ?? "";
      const family = readDeclaration(block, "font-family");
      const src = readDeclaration(block, "src");

      if (family !== undefined && src !== undefined && referencesBundledFont(src, fontFiles)) {
        bundledFonts.add(normalizeFontKey(stripQuotes(family)));
      }
    }
  }

  const warned = new Set();
  for (const source of styleSources) {
    const css = source.text.replace(CSS_COMMENT_PATTERN, "");

    for (const match of css.matchAll(FONT_FAMILY_PATTERN)) {
      for (const family of splitFontFamilies(match[1] ?? "")) {
        const key = normalizeFontKey(family);
        if (DEFAULT_FONT_FAMILIES.has(key) || bundledFonts.has(key)) {
          continue;
        }

        const warningKey = `${source.label}\0${key}`;
        if (warned.has(warningKey)) {
          continue;
        }

        warned.add(warningKey);
        result.warnings.push(
          `${source.label}: font-family "${family}" is not bundled in fonts/ and is not a default font.`,
        );
      }
    }
  }
}

function collectBundledFontKeys(fontFiles) {
  const keys = new Set();

  for (const font of fontFiles) {
    const base = path.posix.basename(font.relativePath).replace(/\.[^.]+$/, "");
    keys.add(normalizeFontKey(base));
    keys.add(normalizeFontKey(base.replace(FONT_STYLE_SUFFIX_PATTERN, "")));

    const parts = base.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
    while (parts.length > 1 && FONT_STYLE_TOKENS.has(parts[parts.length - 1].toLowerCase())) {
      parts.pop();
    }
    keys.add(normalizeFontKey(parts.join("")));
  }

  return keys;
}

function readDeclaration(block, name) {
  const pattern = new RegExp(`${name}\\s*:\\s*([^;}]*)`, "i");
  const match = pattern.exec(block);
  return match?.[1]?.trim();
}

function referencesBundledFont(src, fontFiles) {
  for (const match of src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const url = (match[2] ?? "").trim();
    if (url.length === 0 || url.startsWith("data:")) {
      continue;
    }

    const normalized = url.replace(/^\.\//, "").split(/[?#]/)[0];
    if (
      fontFiles.some(
        (font) => font.relativePath === normalized || font.relativePath.endsWith(`/${normalized}`),
      )
    ) {
      return true;
    }
  }

  return false;
}

function splitFontFamilies(value) {
  const families = [];
  let current = "";
  let quote = null;
  let depth = 0;

  for (const character of value) {
    if (quote !== null) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      families.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  families.push(current);

  return families
    .map((family) => stripQuotes(family.replace(/\s*!important\s*$/i, "")))
    .filter((family) => family.length > 0)
    .filter((family) => !family.toLowerCase().startsWith("var("));
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeFontKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function registerUnique(owners, value, kind, relativePath, result) {
  const owner = owners.get(value);
  if (owner === undefined) {
    owners.set(value, { relativePath, result });
    return;
  }

  const message = `Duplicate template ${kind} "${value}" is also used by ${owner.relativePath}.`;
  if (!result.errors.includes(message)) {
    result.errors.push(message);
  }

  const ownerMessage = `Duplicate template ${kind} "${value}" is also used by ${relativePath}.`;
  if (!owner.result.errors.includes(ownerMessage)) {
    owner.result.errors.push(ownerMessage);
  }
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printReport(report) {
  for (const template of report.templates) {
    console.log(`${template.ok ? "PASS" : "FAIL"} ${TEMPLATES_DIRECTORY}/${template.template}`);

    for (const error of template.errors) {
      console.error(`  error: ${error}`);
    }
    for (const warning of template.warnings) {
      console.warn(`  warning: ${warning}`);
    }
  }

  for (const error of report.errors) {
    console.error(`error: ${error}`);
  }

  const passed = report.templates.filter((template) => template.ok).length;
  const failed = report.templates.length - passed;
  console.log(
    `${report.templates.length} template(s) checked: ${passed} passed, ${failed} failed, ` +
      `${report.warnings.length} warning(s).`,
  );
}

async function main() {
  const [argument] = process.argv.slice(2);
  if (argument !== undefined) {
    throw new Error(`Unknown argument "${argument}".\nUsage: pnpm template:validate`);
  }

  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const report = await validateTemplates(repositoryRoot);
  printReport(report);

  if (!report.ok) {
    process.exitCode = 1;
  }
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
