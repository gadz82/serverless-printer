import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  checkPdfaMarkers,
  checkPrerequisites,
  compareDocuments,
  extractDocument,
  parseRenderArguments,
  REFERENCE_DIRECTORY,
  renderScenario,
  RenderRegressionError,
  runRenderRegression,
} from "../../scripts/render-regression.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEMPLATE_DIRECTORY = path.join(REPOSITORY_ROOT, "templates", "generic-report");
const prerequisites = checkPrerequisites();
const required = process.env.RENDER_REGRESSION_REQUIRED === "1";
const temporaryDirectories = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("render regression arguments", () => {
  it("defaults to check mode", () => {
    expect(parseRenderArguments([])).toEqual({ mode: "check", allowSkip: false, help: false });
  });

  it("accepts update and allow-skip", () => {
    expect(parseRenderArguments(["--update", "--allow-skip"])).toEqual({
      mode: "update",
      allowSkip: true,
      help: false,
    });
  });

  it("rejects check combined with update", () => {
    expect(() => parseRenderArguments(["--check", "--update"])).toThrow(RenderRegressionError);
  });
});

describe("render regression comparison", () => {
  const expected = {
    pageCount: 1,
    text: "Quarterly report\nTotal 4,200.00",
    imageHashes: ["page-one", "page-two"],
  };

  it("accepts identical documents", () => {
    expect(compareDocuments(expected, expected)).toEqual({ matches: true, differences: [] });
  });

  it("reports page count, text and page-image differences", () => {
    const comparison = compareDocuments(
      {
        pageCount: 2,
        text: "Quarterly report\nTotal 4,100.00",
        imageHashes: ["page-one", "changed"],
      },
      expected,
    );

    expect(comparison.matches).toBe(false);
    expect(comparison.differences).toEqual([
      "page count: expected 1, received 2",
      'text: first difference at line 2: expected "Total 4,200.00", received "Total 4,100.00"',
      "page 2 image hash: expected page-two, received changed",
    ]);
  });
});

describe("render regression prerequisites", () => {
  it("reports every missing prerequisite without throwing", () => {
    expect(Array.isArray(prerequisites.problems)).toBe(true);
    expect(typeof prerequisites.ok).toBe("boolean");
  });

  it("fails in required mode when the host cannot render the references", () => {
    if (required) {
      expect(prerequisites).toEqual({ ok: true, problems: [] });
    }
  });
});

describe("PDF/A reference markers", () => {
  it("proves the PDF/A scenario was archived", async () => {
    const [pdfa, plain] = await Promise.all([
      readFile(path.join(REFERENCE_DIRECTORY, "pdfa-2b.pdf")),
      readFile(path.join(REFERENCE_DIRECTORY, "plain.pdf")),
    ]);

    expect(await checkPdfaMarkers(pdfa)).toEqual({ ok: true, missing: [] });
    const plainMarkers = await checkPdfaMarkers(plain);
    expect(plainMarkers.ok).toBe(false);
    expect(plainMarkers.missing).toContain("GTS_PDFA1 output intent");
  });
});

describe.skipIf(!prerequisites.ok)("render regression against the committed references", () => {
  it("matches the plain and PDF/A-2b references", async () => {
    const result = await runRenderRegression({ mode: "check" });

    expect(result.skipped).toBe(false);
    expect(result.scenarios.map((scenario) => scenario.name)).toEqual(["plain", "pdfa-2b"]);
    for (const scenario of result.scenarios) {
      expect(scenario.differences, scenario.name).toEqual([]);
      expect(scenario.matches, scenario.name).toBe(true);
    }
  }, 240_000);

  it("fails the comparison for a deliberate template change", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "printer-changed-template-"));
    temporaryDirectories.push(directory);
    await cp(TEMPLATE_DIRECTORY, directory, { recursive: true });

    const indexPath = path.join(directory, "index.html");
    const source = await readFile(indexPath, "utf8");
    await writeFile(indexPath, source.replace("Business report", "Changed report"));

    const changedPdf = await renderScenario({ templateDirectory: directory });
    const changedPdfPath = path.join(directory, "changed.pdf");
    await writeFile(changedPdfPath, changedPdf);

    const comparison = compareDocuments(
      extractDocument(changedPdfPath),
      extractDocument(path.join(REFERENCE_DIRECTORY, "plain.pdf")),
    );

    expect(comparison.matches).toBe(false);
    expect(comparison.differences.some((difference) => difference.startsWith("text:"))).toBe(true);
  }, 240_000);
});
