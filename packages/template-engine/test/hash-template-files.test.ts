import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TemplateHashError, hashTemplateFiles } from "../src/index.js";

const temporaryDirectories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "printer-template-hash-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileIn(
  directory: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const filePath = path.join(directory, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("hashTemplateFiles", () => {
  it("is stable across runs and changes when content changes", async () => {
    const directory = await createDirectory();
    await writeFileIn(directory, "index.html", "<p>{{message}}</p>");
    await writeFileIn(directory, "styles.css", "body { color: #111; }");

    const first = await hashTemplateFiles(directory);
    const second = await hashTemplateFiles(directory);

    expect(second).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);

    await writeFileIn(directory, "index.html", "<p>{{message}} changed</p>");

    expect(await hashTemplateFiles(directory)).not.toBe(first);
  });

  it("is independent of the template directory location", async () => {
    const firstDirectory = await createDirectory();
    const secondDirectory = await createDirectory();

    for (const directory of [firstDirectory, secondDirectory]) {
      await writeFileIn(directory, "index.html", "<p>{{message}}</p>");
      await writeFileIn(directory, "fonts/report.woff2", "font-bytes");
    }

    expect(await hashTemplateFiles(firstDirectory)).toBe(await hashTemplateFiles(secondDirectory));
  });

  it("changes when a file path changes", async () => {
    const firstDirectory = await createDirectory();
    const secondDirectory = await createDirectory();
    await writeFileIn(firstDirectory, "index.html", "same");
    await writeFileIn(secondDirectory, "page.html", "same");

    expect(await hashTemplateFiles(firstDirectory)).not.toBe(
      await hashTemplateFiles(secondDirectory),
    );
  });

  it("ignores dot files and dot directories", async () => {
    const directory = await createDirectory();
    await writeFileIn(directory, "index.html", "<p>{{message}}</p>");

    const before = await hashTemplateFiles(directory);
    await writeFileIn(directory, ".DS_Store", "ignored");
    await writeFileIn(directory, ".cache/entry", "ignored");

    expect(await hashTemplateFiles(directory)).toBe(before);
  });

  it("hashes an explicit file list like the containing directory", async () => {
    const directory = await createDirectory();
    const indexFile = await writeFileIn(directory, "index.html", "<p>{{message}}</p>");
    const styleFile = await writeFileIn(directory, "styles.css", "body { color: #111; }");
    await writeFileIn(directory, ".hidden", "ignored");

    const fromDirectory = await hashTemplateFiles(directory);
    const fromList = await hashTemplateFiles([styleFile, indexFile]);

    expect(fromList).toBe(fromDirectory);
    expect(await hashTemplateFiles([indexFile, styleFile, path.join(directory, ".hidden")])).toBe(
      fromDirectory,
    );
  });

  it("fails clearly when an input path does not exist", async () => {
    const directory = await createDirectory();

    await expect(hashTemplateFiles(path.join(directory, "missing.html"))).rejects.toThrow(
      TemplateHashError,
    );
  });
});
