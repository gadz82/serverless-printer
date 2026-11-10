import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { checkTemplates } from "./template-check.mjs";

const execFileAsync = promisify(execFile);

const FIRST_ID = "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11";
const SECOND_ID = "9f5d9d5e-1f0a-4b65-9d67-1b3d5f7a9c21";

const temporaryRoots = [];

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "printer-template-check-"));
  temporaryRoots.push(root);
  return root;
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout;
}

async function createRepository() {
  const root = await createRoot();
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "p102@example.test"]);
  await git(root, ["config", "user.name", "P-102 Test"]);
  return root;
}

async function writeTemplate(root, directory, descriptor) {
  const templateDirectory = path.join(root, "templates", directory);
  const fullDescriptor = {
    name: `Template ${directory}`,
    description: "Test template",
    ...descriptor,
  };
  await mkdir(templateDirectory, { recursive: true });
  await writeFile(
    path.join(templateDirectory, "template.json"),
    `${JSON.stringify(fullDescriptor, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(templateDirectory, "index.html"),
    '<!doctype html>\n<html lang="en"><body><p>{{title}}</p></body></html>\n',
    "utf8",
  );
  await writeFile(path.join(templateDirectory, "sample.json"), '{ "title": "Report" }\n', "utf8");
}

async function updateDescriptor(root, directory, changes) {
  const descriptorPath = path.join(root, "templates", directory, "template.json");
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  await writeFile(
    descriptorPath,
    `${JSON.stringify({ ...descriptor, ...changes }, null, 2)}\n`,
    "utf8",
  );
}

async function commit(root, message) {
  await git(root, ["add", "-A"]);
  await git(root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
}

function statuses(report) {
  return Object.fromEntries(
    report.templates.map((template) => [template.template, template.status]),
  );
}

function allErrors(report) {
  return [...report.errors, ...report.templates.flatMap((template) => template.errors)].join("\n");
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("template:check", () => {
  it("accepts unchanged templates and allows new templates", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await writeTemplate(root, "beta", { id: SECOND_ID, slug: "beta" });

    const report = await checkTemplates(root);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(statuses(report)).toEqual({
      "templates/alpha": "unchanged",
      "templates/beta": "new",
    });
  });

  it("rejects a changed id", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await updateDescriptor(root, "alpha", { id: SECOND_ID });

    const report = await checkTemplates(root, "HEAD");

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /id changed from "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11" to "9f5d9d5e-1f0a-4b65-9d67-1b3d5f7a9c21"/,
    );
    expect(statuses(report)).toEqual({ "templates/alpha": "changed" });
  });

  it("rejects a changed slug", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await updateDescriptor(root, "alpha", { slug: "renamed" });

    const report = await checkTemplates(root, "HEAD");

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(/slug changed from "alpha" to "renamed"/);
  });

  it("rejects a folder move that keeps the same id and slug", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await rename(path.join(root, "templates", "alpha"), path.join(root, "templates", "renamed"));

    const report = await checkTemplates(root, "HEAD");

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /folder moved from templates\/alpha; keep the folder name equal to the slug/,
    );
    expect(statuses(report)).toEqual({ "templates/renamed": "changed" });
  });

  it("rejects a slug reused by a different id", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await writeTemplate(root, "beta", { id: SECOND_ID, slug: "alpha" });

    const report = await checkTemplates(root, "HEAD");

    expect(report.ok).toBe(false);
    expect(allErrors(report)).toMatch(
      /slug "alpha" was used by id "e6b3f1c5-3f3d-4b1b-8a38-2a2f55f0cd11"/,
    );
    expect(statuses(report)).toMatchObject({ "templates/alpha": "unchanged" });
  });

  it("allows a template to be removed", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await writeTemplate(root, "beta", { id: SECOND_ID, slug: "beta" });
    await commit(root, "base");

    await rm(path.join(root, "templates", "beta"), { recursive: true, force: true });

    const report = await checkTemplates(root, "HEAD");

    expect(report.ok).toBe(true);
    expect(statuses(report)).toEqual({
      "templates/alpha": "unchanged",
      "templates/beta": "removed",
    });
  });

  it("fails clearly for a missing base ref", async () => {
    const root = await createRepository();
    await writeTemplate(root, "alpha", { id: FIRST_ID, slug: "alpha" });
    await commit(root, "base");

    await expect(checkTemplates(root, "does-not-exist")).rejects.toThrow(/does not exist/);
  });
});
