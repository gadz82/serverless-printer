import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify, parseArgs } from "node:util";

const execFileAsync = promisify(execFile);

const TEMPLATES_DIRECTORY = "templates";
const TEMPLATE_DESCRIPTOR_PATTERN = /^templates\/[^/]+\/template\.json$/;
const USAGE = [
  "Usage: pnpm template:check [--base <ref>]",
  "Template folders must keep the same name as their slug; moving an existing folder is rejected.",
  "Run pnpm template:validate as well: check does not enforce current id/slug uniqueness.",
].join("\n");

/**
 * @typedef {{ id: string, slug: string, path: string }} TemplateIdentity
 * @typedef {{ template: string, status: "unchanged" | "new" | "changed" | "removed", errors: string[] }} CheckResult
 * @typedef {{ ok: boolean, base: string, templates: CheckResult[], errors: string[] }} CheckReport
 */

/**
 * Compares template identities in the working tree with a Git ref.
 *
 * @param {string} root Repository root that contains the `templates` directory.
 * @param {string} [base] Git ref to compare against.
 * @returns {Promise<CheckReport>}
 */
// ORCHID-MEM: 01a1c51f-4207-7ab3-ac69-281c356e1ffe — Guards template ids and slugs against a Git base commit.
export async function checkTemplates(root, base = "HEAD") {
  const repositoryRoot = path.resolve(root);
  const baseCommit = await resolveCommit(repositoryRoot, base);
  const current = await readCurrentIdentities(repositoryRoot);
  const baseIdentities = await readBaseIdentities(repositoryRoot, baseCommit, base);

  /** @type {CheckReport} */
  const report = {
    ok: false,
    base,
    templates: [],
    errors: [...current.errors],
  };

  const baseByPath = indexBase(baseIdentities, "path");
  const baseById = indexBase(baseIdentities, "id");
  const baseBySlug = indexBase(baseIdentities, "slug");

  for (const identity of current.identities) {
    report.templates.push(compareIdentity(identity, baseByPath, baseById, baseBySlug));
  }

  const currentPaths = new Set(current.identities.map((identity) => identity.path));
  const currentIds = new Set(current.identities.map((identity) => identity.id));
  const currentSlugs = new Set(current.identities.map((identity) => identity.slug));

  for (const identity of baseIdentities) {
    if (
      !currentPaths.has(identity.path) &&
      !currentIds.has(identity.id) &&
      !currentSlugs.has(identity.slug)
    ) {
      report.templates.push({ template: identity.path, status: "removed", errors: [] });
    }
  }

  report.templates.sort((left, right) => compareNames(left.template, right.template));
  report.ok =
    report.errors.length === 0 &&
    report.templates.every((template) => template.errors.length === 0);

  return report;
}

function compareIdentity(identity, baseByPath, baseById, baseBySlug) {
  const baseAtPath = baseByPath.get(identity.path);
  if (baseAtPath !== undefined) {
    const errors = [];
    if (baseAtPath.id !== identity.id) {
      errors.push(
        `Template ${identity.path}: id changed from "${baseAtPath.id}" to "${identity.id}".`,
      );
    }
    if (baseAtPath.slug !== identity.slug) {
      errors.push(
        `Template ${identity.path}: slug changed from "${baseAtPath.slug}" to "${identity.slug}".`,
      );
    }

    return {
      template: identity.path,
      status: errors.length === 0 ? "unchanged" : "changed",
      errors,
    };
  }

  const baseWithId = baseById.get(identity.id);
  if (baseWithId !== undefined) {
    const errors = [];
    if (baseWithId.slug !== identity.slug) {
      errors.push(
        `Template ${identity.path}: slug changed from "${baseWithId.slug}" to ` +
          `"${identity.slug}" (folder moved from ${baseWithId.path}).`,
      );
    } else {
      errors.push(
        `Template ${identity.path}: folder moved from ${baseWithId.path}; ` +
          "keep the folder name equal to the slug.",
      );
    }

    return { template: identity.path, status: "changed", errors };
  }

  const baseWithSlug = baseBySlug.get(identity.slug);
  if (baseWithSlug !== undefined) {
    return {
      template: identity.path,
      status: "changed",
      errors: [
        `Template ${identity.path}: slug "${identity.slug}" was used by id ` +
          `"${baseWithSlug.id}" at ${baseWithSlug.path}; a slug cannot be reused by a different id.`,
      ],
    };
  }

  return { template: identity.path, status: "new", errors: [] };
}

async function readCurrentIdentities(repositoryRoot) {
  const templatesDirectory = path.join(repositoryRoot, TEMPLATES_DIRECTORY);
  const errors = [];

  let entries;
  try {
    entries = await readdir(templatesDirectory, { withFileTypes: true });
  } catch (error) {
    errors.push(`Cannot read templates directory at ${templatesDirectory}: ${errorMessage(error)}`);
    return { identities: [], errors };
  }

  const identities = [];
  const directories = entries
    .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory())
    .sort((left, right) => compareNames(left.name, right.name));

  for (const entry of directories) {
    const relativePath = `${TEMPLATES_DIRECTORY}/${entry.name}`;
    const descriptorPath = path.join(templatesDirectory, entry.name, "template.json");

    let source;
    try {
      source = await readFile(descriptorPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        errors.push(`${relativePath}/template.json is missing.`);
      } else {
        errors.push(`Cannot read ${relativePath}/template.json: ${errorMessage(error)}`);
      }
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      errors.push(`Invalid JSON in ${relativePath}/template.json: ${errorMessage(error)}`);
      continue;
    }

    try {
      const id = readRequiredString(parsed, "id", `${relativePath}/template.json`);
      const slug = readRequiredString(parsed, "slug", `${relativePath}/template.json`);
      identities.push({ id, slug, path: relativePath });
    } catch (error) {
      errors.push(
        `Invalid template identity in ${relativePath}/template.json: ${errorMessage(error)}`,
      );
    }
  }

  return { identities, errors };
}

async function readBaseIdentities(repositoryRoot, baseCommit, baseLabel) {
  const output = await runGit(repositoryRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    "--full-tree",
    baseCommit,
    "--",
    TEMPLATES_DIRECTORY,
  ]);

  const descriptorPaths = output
    .split("\0")
    .filter((file) => file.length > 0 && TEMPLATE_DESCRIPTOR_PATTERN.test(file))
    .sort(compareNames);

  const identities = [];
  for (const descriptorPath of descriptorPaths) {
    let source;
    try {
      source = await runGit(repositoryRoot, ["show", `${baseCommit}:${descriptorPath}`]);
    } catch (error) {
      throw new Error(`Cannot read ${descriptorPath} at ${baseLabel}: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`Invalid JSON in ${descriptorPath} at ${baseLabel}: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    const id = readIdentityString(parsed, "id", descriptorPath, baseLabel);
    const slug = readIdentityString(parsed, "slug", descriptorPath, baseLabel);
    identities.push({ id, slug, path: path.posix.dirname(descriptorPath) });
  }

  assertBaseIsUnambiguous(identities, baseLabel);
  return identities;
}

function readIdentityString(value, field, descriptorPath, baseLabel) {
  return readRequiredString(value, field, `Template ${descriptorPath} at ${baseLabel}`);
}

function readRequiredString(value, field, source) {
  if (!isPlainObject(value) || typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`${source} must define a non-empty string "${field}".`);
  }

  return value[field];
}

function assertBaseIsUnambiguous(identities, baseLabel) {
  for (const field of ["id", "slug"]) {
    /** @type {Map<string, TemplateIdentity>} */
    const seen = new Map();
    for (const identity of identities) {
      const value = identity[field];
      const existing = seen.get(value);
      if (existing !== undefined) {
        throw new Error(
          `Base ref "${baseLabel}" is ambiguous: ${existing.path} and ${identity.path} ` +
            `share the same ${field} "${value}".`,
        );
      }
      seen.set(value, identity);
    }
  }
}

function indexBase(identities, field) {
  /** @type {Map<string, TemplateIdentity>} */
  const index = new Map();
  for (const identity of identities) {
    index.set(identity[field], identity);
  }
  return index;
}

async function resolveCommit(repositoryRoot, base) {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new Error(`A Git base ref is required.\n${USAGE}`);
  }

  try {
    const output = await runGit(repositoryRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${base}^{commit}`,
    ]);
    const commit = output.trim();
    if (commit.length === 0) {
      throw new Error("git rev-parse returned an empty commit");
    }
    return commit;
  } catch (error) {
    const detail = gitErrorDetail(error);
    if (detail.includes("not a git repository")) {
      throw new Error(
        `${repositoryRoot} is not a Git repository; template:check needs Git history.`,
        { cause: error },
      );
    }

    throw new Error(
      `Git ref "${base}" does not exist in ${repositoryRoot}. ` +
        "Pass --base <ref> with a commit, branch or tag.",
      { cause: error },
    );
  }
}

async function runGit(repositoryRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed in ${repositoryRoot}: ${gitErrorDetail(error)}`, {
      cause: error,
    });
  }
}

function gitErrorDetail(error) {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const stderr = "stderr" in error ? String(error.stderr).trim() : "";
  if (stderr.length > 0) {
    return stderr;
  }

  const stdout = "stdout" in error ? String(error.stdout).trim() : "";
  if (stdout.length > 0) {
    return stdout;
  }

  return errorMessage(error);
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
    console.log(
      `${template.errors.length === 0 ? "PASS" : "FAIL"} ${template.template} (${template.status})`,
    );
    for (const error of template.errors) {
      console.error(`  error: ${error}`);
    }
  }

  for (const error of report.errors) {
    console.error(`error: ${error}`);
  }

  const counts = { unchanged: 0, new: 0, changed: 0, removed: 0 };
  for (const template of report.templates) {
    counts[template.status] += 1;
  }

  console.log(
    `Checked ${report.templates.length} template(s) against ${report.base}: ` +
      `${counts.unchanged} unchanged, ${counts.new} new, ${counts.changed} changed, ` +
      `${counts.removed} removed.`,
  );
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        base: { type: "string", short: "b", default: "HEAD" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    throw new Error(`Invalid arguments: ${errorMessage(error)}\n${USAGE}`);
  }

  if (parsed.values.help) {
    console.log(USAGE);
    return;
  }

  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const report = await checkTemplates(repositoryRoot, parsed.values.base);
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
