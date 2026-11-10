import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { TemplateHashError, errorMessage } from "./errors.js";

export type TemplateFile = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

export async function listTemplateFiles(root: string): Promise<readonly TemplateFile[]> {
  const absoluteRoot = path.resolve(root);
  const files = await walkDirectory(absoluteRoot, "");
  return files.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
}

export async function readPathStats(target: string): Promise<Stats> {
  try {
    return await stat(target);
  } catch (error) {
    throw new TemplateHashError(`cannot read template path ${target}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export function hasIgnoredSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith("."));
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function walkDirectory(directory: string, prefix: string): Promise<TemplateFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new TemplateHashError(
      `cannot read template directory ${directory}: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }

  const files: TemplateFile[] = [];
  const sortedEntries = entries.sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of sortedEntries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}
