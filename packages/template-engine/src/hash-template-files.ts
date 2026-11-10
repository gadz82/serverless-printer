import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { TemplateHashError, errorMessage } from "./errors.js";
import {
  type TemplateFile,
  comparePaths,
  hasIgnoredSegment,
  listTemplateFiles,
  readPathStats,
  toPosixPath,
} from "./template-files.js";

export type TemplateFilesInput = string | readonly string[];

/**
 * Hashes sorted relative file paths and bytes with SHA-256.
 *
 * Paths are made relative to the input directory, or to the common root of an
 * explicit file list, so moving a template tree does not change its hash.
 */
export async function hashTemplateFiles(input: TemplateFilesInput): Promise<string> {
  const files = await collectTemplateFiles(input);
  const hash = createHash("sha256");

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(file.absolutePath);
    } catch (error) {
      throw new TemplateHashError(
        `cannot read template file ${file.absolutePath}: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(bytes);
  }

  return hash.digest("hex");
}

async function collectTemplateFiles(input: TemplateFilesInput): Promise<readonly TemplateFile[]> {
  const targets = typeof input === "string" ? [input] : input;
  if (targets.length === 0) {
    return [];
  }

  const roots: string[] = [];
  const files: TemplateFile[] = [];

  for (const target of targets) {
    const absoluteTarget = path.resolve(target);
    const stats = await readPathStats(absoluteTarget);

    if (stats.isDirectory()) {
      roots.push(absoluteTarget);
      files.push(...(await listTemplateFiles(absoluteTarget)));
      continue;
    }

    if (stats.isFile()) {
      roots.push(path.dirname(absoluteTarget));
      files.push({ absolutePath: absoluteTarget, relativePath: path.basename(absoluteTarget) });
      continue;
    }

    throw new TemplateHashError(`template path is not a file or directory: ${absoluteTarget}`);
  }

  const root = commonRoot(roots);
  const uniqueFiles = new Map<string, TemplateFile>();

  for (const file of files) {
    const relativePath = toPosixPath(path.relative(root, file.absolutePath));
    if (hasIgnoredSegment(relativePath)) {
      continue;
    }

    uniqueFiles.set(file.absolutePath, { absolutePath: file.absolutePath, relativePath });
  }

  return [...uniqueFiles.values()].sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath),
  );
}

function commonRoot(roots: readonly string[]): string {
  const first = roots[0];
  if (first === undefined) {
    return process.cwd();
  }

  let candidate = first;

  for (const root of roots.slice(1)) {
    while (!containsPath(candidate, root)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return candidate;
      }
      candidate = parent;
    }
  }

  return candidate;
}

function containsPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
