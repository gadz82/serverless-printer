import type { HandlebarsMode } from "./compile-template.js";
import { TemplateRenderError } from "./errors.js";
import type { PlaceholderTree } from "./extract-placeholders.js";
import { isPlaceholderTree } from "./extract-placeholders.js";

/**
 * Checks rendered data against the placeholder tree before Handlebars runs.
 *
 * This exists because Handlebars' strict option does not validate block helper
 * arguments such as `{{#if active}}` or `{{#each items}}`.
 */
export function validateTemplateData(
  placeholders: PlaceholderTree,
  data: unknown,
  mode: HandlebarsMode,
): void {
  if (mode === "lenient") {
    return;
  }

  if (mode === "strict") {
    validateStrictTree(placeholders, data, "");
    return;
  }

  validateAssumeObjectsTree(placeholders, data, "");
}

function validateStrictTree(tree: PlaceholderTree, data: unknown, prefix: string): void {
  for (const [key, node] of Object.entries(tree)) {
    const path = joinPath(prefix, key);
    requireOwnProperty(data, key, path);
    const value = readOwnProperty(data, key);

    if (isPlaceholderTree(node)) {
      if (!isObjectLike(value)) {
        throw new TemplateRenderError(
          `template data "${path}" must be an object to resolve nested fields`,
        );
      }

      validateStrictTree(node, value, path);
    }
  }
}

function validateAssumeObjectsTree(tree: PlaceholderTree, data: unknown, prefix: string): void {
  for (const [key, node] of Object.entries(tree)) {
    const path = joinPath(prefix, key);

    if (isPlaceholderTree(node)) {
      requireOwnProperty(data, key, path);
      const value = readOwnProperty(data, key);
      if (!isObjectLike(value)) {
        throw new TemplateRenderError(
          `template data "${path}" must be an object to resolve nested fields`,
        );
      }

      validateAssumeObjectsTree(node, value, path);
      continue;
    }

    if (node === "array") {
      requireOwnProperty(data, key, path);
      if (!Array.isArray(readOwnProperty(data, key))) {
        throw new TemplateRenderError(`template data "${path}" must be an array`);
      }
      continue;
    }

    if (node === "object") {
      requireOwnProperty(data, key, path);
      if (!isObjectLike(readOwnProperty(data, key))) {
        throw new TemplateRenderError(`template data "${path}" must be an object`);
      }
    }

    // A missing string leaf or if/unless boolean is allowed in assume-objects.
  }
}

function requireOwnProperty(data: unknown, key: string, path: string): void {
  if (!isObjectLike(data) || !Object.hasOwn(data, key)) {
    throw new TemplateRenderError(`template data is missing "${path}"`);
  }
}

function readOwnProperty(data: unknown, key: string): unknown {
  if (!isObjectLike(data) || !Object.hasOwn(data, key)) {
    return undefined;
  }

  return data[key];
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function joinPath(prefix: string, key: string): string {
  return prefix.length === 0 ? key : `${prefix}.${key}`;
}
