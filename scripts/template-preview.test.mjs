import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  findChromeExecutable,
  parsePreviewArguments,
  previewTemplate,
} from "./template-preview.mjs";
import { validateTemplates } from "./template-validate.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME_EXECUTABLE = findChromeExecutable();
const temporaryDirectories = [];

if (CHROME_EXECUTABLE === undefined) {
  console.warn(
    "Chrome not found; set CHROME_PATH or install Google Chrome. " +
      "Skipping the template preview render test.",
  );
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "printer-template-preview-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("template:preview", () => {
  it("accepts the shipped generic-report template", async () => {
    const report = await validateTemplates(REPOSITORY_ROOT);
    const genericReport = report.templates.find(
      (template) => template.template === "generic-report",
    );

    expect(genericReport).toBeDefined();
    expect(genericReport).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(report.ok).toBe(true);
  });

  it("rejects --pdfa with the Slice 2 message", () => {
    expect(() => parsePreviewArguments(["generic-report", "--pdfa", "PDF/A-2b"])).toThrow(
      /available in Slice 2/,
    );
  });

  it("rejects malformed --data JSON before launching Chrome", async () => {
    const directory = await createTemporaryDirectory();
    const dataPath = path.join(directory, "bad-data.json");
    await writeFile(dataPath, "{ not json", "utf8");

    await expect(
      previewTemplate(REPOSITORY_ROOT, { slug: "generic-report", dataPath }),
    ).rejects.toThrow(/Invalid JSON in data file/);
  });

  it.skipIf(CHROME_EXECUTABLE === undefined)(
    "renders generic-report into a PDF file",
    { timeout: 30_000 },
    async () => {
      const outputDirectory = await createTemporaryDirectory();
      const result = await previewTemplate(REPOSITORY_ROOT, {
        slug: "generic-report",
        outputDirectory,
      });
      const written = await readFile(result.outputPath);

      expect(result.outputPath).toBe(path.join(outputDirectory, "generic-report.pdf"));
      expect(written.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(written.byteLength).toBe(result.pdf.byteLength);
    },
  );
});
