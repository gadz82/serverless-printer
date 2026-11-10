import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  TemplateCompileError,
  TemplateDescriptorError,
  TemplateManifestError,
  errorMessage,
} from "./errors.js";
import { compileTemplate } from "./compile-template.js";
import {
  type PlaceholderTree,
  createPlaceholderTree,
  extractPlaceholders,
  mergePlaceholders,
  sortPlaceholders,
} from "./extract-placeholders.js";
import { hashTemplateFiles } from "./hash-template-files.js";
import { comparePaths, listTemplateFiles } from "./template-files.js";
import { type TemplateDescriptor, validateTemplateDescriptor } from "./template-descriptor.js";

export type TemplateManifestEntry = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly path: string;
  readonly contentHash: string;
  readonly placeholders: PlaceholderTree;
};

export type TemplateManifest = {
  readonly release: string;
  readonly templates: readonly TemplateManifestEntry[];
};

const HTML_FILE_PATTERN = /\.(?:html|hbs)$/i;

/**
 * Builds the deterministic, release-aware manifest for every template folder
 * under `<root>/templates`.
 */
export async function buildManifest(root: string, release = "local"): Promise<TemplateManifest> {
  const releaseValue = readRelease(release);
  const repositoryRoot = path.resolve(root);
  const templatesDirectory = path.join(repositoryRoot, "templates");

  let entries: Dirent[];
  try {
    entries = await readdir(templatesDirectory, { withFileTypes: true });
  } catch (error) {
    throw new TemplateManifestError(
      `Cannot read templates directory at ${templatesDirectory}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const directories = entries
    .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory())
    .sort((left, right) => comparePaths(left.name, right.name));

  const templates: TemplateManifestEntry[] = [];
  const ids = new Map<string, string>();
  const slugs = new Map<string, string>();

  for (const entry of directories) {
    const relativePath = `templates/${entry.name}`;
    const templateDirectory = path.join(templatesDirectory, entry.name);
    const descriptorPath = path.join(templateDirectory, "template.json");

    let descriptorSource: string;
    try {
      descriptorSource = await readFile(descriptorPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw new TemplateManifestError(`Cannot read ${descriptorPath}: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    let parsedDescriptor: unknown;
    try {
      parsedDescriptor = JSON.parse(descriptorSource);
    } catch (error) {
      throw new TemplateManifestError(`Invalid JSON in ${descriptorPath}: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    const descriptor = readDescriptor(parsedDescriptor, descriptorPath);
    registerUnique(ids, descriptor.id, "id", relativePath);
    registerUnique(slugs, descriptor.slug, "slug", relativePath);

    templates.push({
      id: descriptor.id,
      slug: descriptor.slug,
      name: descriptor.name,
      path: relativePath,
      contentHash: await hashTemplateFiles(templateDirectory),
      placeholders: await extractTemplatePlaceholders(templateDirectory),
    });
  }

  templates.sort((left, right) => comparePaths(left.slug, right.slug));

  return { release: releaseValue, templates };
}

function readRelease(release: string): string {
  if (typeof release !== "string" || release.trim().length === 0) {
    throw new TemplateManifestError("template manifest release must be a non-empty string");
  }

  return release;
}

function readDescriptor(value: unknown, source: string): TemplateDescriptor {
  try {
    return validateTemplateDescriptor(value);
  } catch (error) {
    if (error instanceof TemplateDescriptorError) {
      throw new TemplateManifestError(
        `Invalid template descriptor in ${source}: ${error.message}`,
        { cause: error },
      );
    }

    throw error;
  }
}

async function extractTemplatePlaceholders(templateDirectory: string): Promise<PlaceholderTree> {
  const files = await listTemplateFiles(templateDirectory);
  const placeholders = createPlaceholderTree();

  for (const file of files) {
    if (!HTML_FILE_PATTERN.test(file.relativePath)) {
      continue;
    }

    let source: string;
    try {
      source = await readFile(file.absolutePath, "utf8");
    } catch (error) {
      throw new TemplateManifestError(
        `Cannot read template file ${file.absolutePath}: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    try {
      compileTemplate(source, { mode: "lenient" });
      mergePlaceholders(placeholders, extractPlaceholders(source));
    } catch (error) {
      if (error instanceof TemplateCompileError) {
        throw new TemplateManifestError(
          `Invalid Handlebars in ${file.absolutePath}: ${error.message}`,
          { cause: error },
        );
      }

      throw error;
    }
  }

  return sortPlaceholders(placeholders);
}

function registerUnique(
  seen: Map<string, string>,
  value: string,
  kind: string,
  source: string,
): void {
  const existingSource = seen.get(value);

  if (existingSource !== undefined) {
    throw new TemplateManifestError(
      `Duplicate template ${kind} "${value}" in ${source} and ${existingSource}.`,
    );
  }

  seen.set(value, source);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
