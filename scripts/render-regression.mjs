import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { register } from "tsx/esm/api";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const REFERENCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "tests",
  "render",
  "reference",
  "generic-report",
);
const TEMPLATE_SLUG = "generic-report";
const PDFA_LEVEL = "PDF/A-2b";
const GENERATED_AT = new Date("2026-11-01T09:30:00.000Z");
const REQUIRED_TOOLS = ["pdfinfo", "pdftotext", "pdftoppm"];

export const SCENARIOS = Object.freeze([
  Object.freeze({ name: "plain", archiveLevel: undefined }),
  Object.freeze({ name: "pdfa-2b", archiveLevel: PDFA_LEVEL }),
]);

const USAGE = [
  "Usage: node scripts/render-regression.mjs [--check|--update] [--allow-skip]",
  "",
  "  --check       Render both scenarios and compare with the committed references (default).",
  "  --update      Render both scenarios and replace the committed reference PDFs.",
  "  --allow-skip  Exit successfully when the host is not Linux x86_64 or poppler is missing.",
  "",
  "Reference updates must run on Linux x86_64 with poppler-utils; see tests/render/README.md.",
].join("\n");

export class RenderRegressionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RenderRegressionError";
  }
}

/**
 * Returns the problems that prevent the real Lambda Chromium renderer and the
 * poppler comparison from running on this host.
 *
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkPrerequisites() {
  const problems = [];

  if (process.platform !== "linux" || process.arch !== "x64") {
    problems.push(
      `@sparticuz/chromium requires linux x64; this host is ${process.platform} ${process.arch}`,
    );
  }

  for (const tool of REQUIRED_TOOLS) {
    const result = spawnSync(tool, ["-v"], { encoding: "utf8" });
    if (result.error !== undefined) {
      problems.push(`${tool} is not installed; install poppler-utils`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * @param {readonly string[]} argv
 * @returns {{ mode: "check" | "update", allowSkip: boolean, help: boolean }}
 */
export function parseRenderArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        check: { type: "boolean", default: false },
        update: { type: "boolean", default: false },
        "allow-skip": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    throw new RenderRegressionError(`${errorMessage(error)}\n${USAGE}`, { cause: error });
  }

  if (parsed.values.help === true) {
    return { mode: "check", allowSkip: false, help: true };
  }

  if (parsed.values.check === true && parsed.values.update === true) {
    throw new RenderRegressionError(`--check and --update cannot be combined.\n${USAGE}`);
  }

  return {
    mode: parsed.values.update === true ? "update" : "check",
    allowSkip: parsed.values["allow-skip"] === true,
    help: false,
  };
}

/**
 * Renders `generic-report` with the real Lambda Chromium adapter and, when
 * requested, archives it as PDF/A-2b.
 *
 * @param {{ root?: string, templateDirectory?: string, archiveLevel?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function renderScenario(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const templateDirectory = path.resolve(
    options.templateDirectory ?? path.join(root, "templates", TEMPLATE_SLUG),
  );
  const { compileTemplate } = await loadTemplateEngine();
  const { ChromiumPdfRenderer } = await loadWorkerModules();

  const [source, sampleSource] = await Promise.all([
    readFile(path.join(templateDirectory, "index.html"), "utf8"),
    readFile(path.join(templateDirectory, "sample.json"), "utf8"),
  ]);
  const sample = JSON.parse(sampleSource);
  if (sample === null || typeof sample !== "object" || Array.isArray(sample)) {
    throw new RenderRegressionError("sample.json must contain a JSON object");
  }

  const html = compileTemplate(source, { mode: "lenient" })(sample);
  // Lambda extracts the bundled Open Sans fonts and sets FONTCONFIG_PATH at
  // import time. Do the same on CI so the references exercise the production
  // font stack instead of the host's system fonts.
  process.env.FONTCONFIG_PATH ??= path.join(tmpdir(), "fonts");
  const renderer = new ChromiumPdfRenderer();

  try {
    const plain = await renderer.render({ html, baseDirectory: templateDirectory });
    if (options.archiveLevel === undefined) {
      return plain;
    }

    const { PdfLibPdfArchiver } = await loadWorkerModules();
    return await new PdfLibPdfArchiver().archive(plain, {
      level: options.archiveLevel,
      title: typeof sample.title === "string" ? sample.title : undefined,
      language: "en",
      createdAt: GENERATED_AT,
    });
  } finally {
    await renderer.close();
  }
}

/**
 * Extracts the comparison surface of a PDF: page count, layout text and a
 * hash per rasterized page. PGM output is used because it has no image
 * metadata that could change between runs.
 *
 * @param {string} pdfPath
 * @returns {{ pageCount: number, text: string, imageHashes: string[] }}
 */
export function extractDocument(pdfPath) {
  const info = runTool("pdfinfo", [pdfPath]);
  const pageMatch = /^Pages:\s+(\d+)\s*$/m.exec(info);
  if (pageMatch === null) {
    throw new RenderRegressionError(`pdfinfo did not report a page count for ${pdfPath}`);
  }

  const text = normalizeText(runTool("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"]));
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "printer-render-pages-"));
  let imageHashes;
  try {
    runTool("pdftoppm", ["-r", "72", "-gray", pdfPath, path.join(temporaryDirectory, "page")]);
    const images = readdirSync(temporaryDirectory).filter((name) => name.endsWith(".pgm"));
    if (images.length === 0) {
      throw new RenderRegressionError(`pdftoppm produced no pages for ${pdfPath}`);
    }
    imageHashes = images.sort().map((name) => sha256File(path.join(temporaryDirectory, name)));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  return { pageCount: Number(pageMatch[1]), text, imageHashes };
}

/**
 * Compares two extracted documents. Text differences are reported as the
 * first divergence instead of dumping the whole document.
 *
 * @param {{ pageCount: number, text: string, imageHashes: string[] }} actual
 * @param {{ pageCount: number, text: string, imageHashes: string[] }} expected
 * @returns {{ matches: boolean, differences: string[] }}
 */
export function compareDocuments(actual, expected) {
  const differences = [];

  if (actual.pageCount !== expected.pageCount) {
    differences.push(`page count: expected ${expected.pageCount}, received ${actual.pageCount}`);
  }

  if (actual.text !== expected.text) {
    differences.push(`text: ${describeTextDifference(actual.text, expected.text)}`);
  }

  if (actual.imageHashes.length !== expected.imageHashes.length) {
    differences.push(
      `page images: expected ${expected.imageHashes.length}, received ${actual.imageHashes.length}`,
    );
  } else {
    for (const [index, expectedHash] of expected.imageHashes.entries()) {
      if (actual.imageHashes[index] !== expectedHash) {
        differences.push(
          `page ${index + 1} image hash: expected ${expectedHash}, received ${actual.imageHashes[index]}`,
        );
      }
    }
  }

  return { matches: differences.length === 0, differences };
}

/**
 * Checks the PDF/A-2b markers the archiver is responsible for. This is not a
 * validator; it only proves the PDF/A scenario actually archived the render.
 *
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<{ ok: boolean, missing: string[] }>}
 */
export async function checkPdfaMarkers(pdfBytes) {
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = await loadPdfLib();
  const source = Buffer.from(pdfBytes).toString("latin1");
  const missing = [];

  if (!/^%PDF-1\.7/.test(source)) {
    missing.push("%PDF-1.7 header");
  }
  if (!source.includes("GTS_PDFA1")) {
    missing.push("GTS_PDFA1 output intent");
  }

  // XMP is a Flate-compressed metadata stream, so read it through pdf-lib
  // instead of searching the raw bytes.
  let xmp = "";
  try {
    const document = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const metadata = document.catalog.get(PDFName.of("Metadata"));
    const stream = metadata === undefined ? undefined : document.context.lookup(metadata);
    if (stream instanceof PDFRawStream) {
      xmp = Buffer.from(decodePDFRawStream(stream).decode()).toString("utf8");
    }
  } catch {
    missing.push("readable PDF metadata");
  }

  if (!/pdfaid:part(?:\s*=\s*["']2["']|>2<)/.test(xmp)) {
    missing.push("pdfaid:part=2");
  }
  if (!/pdfaid:conformance(?:\s*=\s*["']B["']|>B<)/.test(xmp)) {
    missing.push("pdfaid:conformance=B");
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Renders both scenarios and either compares or refreshes the references.
 *
 * @param {{
 *   mode?: "check" | "update",
 *   allowSkip?: boolean,
 *   root?: string,
 *   referenceDirectory?: string,
 *   render?: typeof renderScenario,
 *   extract?: typeof extractDocument
 * }} [options]
 * @returns {Promise<{ skipped: boolean, reason?: string, scenarios: Array<{ name: string, referencePath: string, matches: boolean, differences: string[], hashes?: Record<string, unknown> }> }>}
 */
// ORCHID-MEM: 01a1c6e2-7513-71d9-ae96-e93bc181897d — Renders plain and PDF/A scenarios with Lambda Chromium and compares references.
export async function runRenderRegression(options = {}) {
  const prerequisites = checkPrerequisites();
  if (!prerequisites.ok) {
    if (options.allowSkip === true) {
      return { skipped: true, reason: prerequisites.problems.join("; "), scenarios: [] };
    }

    throw new RenderRegressionError(
      `render regression prerequisites are missing:\n- ${prerequisites.problems.join("\n- ")}`,
    );
  }

  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const referenceDirectory = path.resolve(options.referenceDirectory ?? REFERENCE_DIRECTORY);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "printer-render-regression-"));
  const results = [];
  const rendered = [];

  try {
    for (const scenario of SCENARIOS) {
      const pdf = await (options.render ?? renderScenario)({
        root,
        archiveLevel: scenario.archiveLevel,
      });
      if (scenario.archiveLevel !== undefined) {
        const markers = await checkPdfaMarkers(pdf);
        if (!markers.ok) {
          throw new RenderRegressionError(
            `${scenario.name} is missing PDF/A markers: ${markers.missing.join(", ")}`,
          );
        }
      }

      const actualPath = path.join(temporaryDirectory, `${scenario.name}.pdf`);
      await writeFile(actualPath, pdf);
      rendered.push({
        scenario,
        pdf,
        referencePath: path.join(referenceDirectory, `${scenario.name}.pdf`),
        extracted: (options.extract ?? extractDocument)(actualPath),
      });
    }

    if (options.mode === "update") {
      // Validate every scenario before replacing any reference.
      await mkdir(referenceDirectory, { recursive: true });
      for (const item of rendered) {
        await writeFile(item.referencePath, item.pdf);
        results.push({
          name: item.scenario.name,
          referencePath: item.referencePath,
          matches: true,
          differences: [],
          hashes: {
            sha256: createHash("sha256").update(item.pdf).digest("hex"),
            pageCount: item.extracted.pageCount,
            textSha256: createHash("sha256").update(item.extracted.text).digest("hex"),
            pageImageHashes: item.extracted.imageHashes,
          },
        });
      }
      return { skipped: false, scenarios: results };
    }

    for (const item of rendered) {
      let reference;
      try {
        reference = await readFile(item.referencePath);
      } catch (error) {
        throw new RenderRegressionError(
          `cannot read reference ${item.referencePath}; run --update on Linux x86_64 first`,
          { cause: error },
        );
      }
      const referenceTempPath = path.join(
        temporaryDirectory,
        `${item.scenario.name}-reference.pdf`,
      );
      await writeFile(referenceTempPath, reference);

      const comparison = compareDocuments(
        item.extracted,
        (options.extract ?? extractDocument)(referenceTempPath),
      );
      results.push({
        name: item.scenario.name,
        referencePath: item.referencePath,
        ...comparison,
      });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return { skipped: false, scenarios: results };
}

/**
 * @param {readonly string[]} [argv]
 */
async function main(argv = process.argv.slice(2)) {
  const options = parseRenderArguments(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runRenderRegression({
    mode: options.mode,
    allowSkip: options.allowSkip,
  });

  if (result.skipped) {
    process.stdout.write(`render regression skipped: ${String(result.reason)}\n`);
    return;
  }

  if (options.mode === "update") {
    for (const scenario of result.scenarios) {
      process.stdout.write(`updated ${scenario.referencePath}\n`);
      process.stdout.write(`  ${JSON.stringify(scenario.hashes)}\n`);
    }
    return;
  }

  const failures = result.scenarios.filter((scenario) => !scenario.matches);
  if (failures.length > 0) {
    for (const scenario of failures) {
      process.stderr.write(`render regression failed for ${scenario.name}:\n`);
      for (const difference of scenario.differences) {
        process.stderr.write(`  - ${difference}\n`);
      }
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `render regression passed for ${result.scenarios.map((scenario) => scenario.name).join(", ")}\n`,
  );
}

let templateEnginePromise;
let workerModulesPromise;

async function loadTemplateEngine() {
  templateEnginePromise ??= (async () => {
    register();
    const engineRequire = createRequire(
      new URL("../packages/template-engine/package.json", import.meta.url),
    );
    const entry = engineRequire.resolve("./src/index.ts");
    return await import(pathToFileURL(entry).href);
  })();

  return await templateEnginePromise;
}

async function loadWorkerModules() {
  workerModulesPromise ??= (async () => {
    register();
    const [renderer, archiver] = await Promise.all([
      import(
        pathToFileURL(
          fileURLToPath(
            new URL(
              "../apps/render-worker/src/rendering/chromium-pdf-renderer.ts",
              import.meta.url,
            ),
          ),
        ).href
      ),
      import(
        pathToFileURL(
          fileURLToPath(
            new URL("../apps/render-worker/src/pdfa/pdf-lib-pdf-archiver.ts", import.meta.url),
          ),
        ).href
      ),
    ]);
    return {
      ChromiumPdfRenderer: renderer.ChromiumPdfRenderer,
      PdfLibPdfArchiver: archiver.PdfLibPdfArchiver,
    };
  })();

  return await workerModulesPromise;
}

let pdfLibPromise;

async function loadPdfLib() {
  pdfLibPromise ??= (async () => {
    const workerRequire = createRequire(
      new URL("../apps/render-worker/package.json", import.meta.url),
    );
    return await import(pathToFileURL(workerRequire.resolve("pdf-lib")).href);
  })();

  return await pdfLibPromise;
}

function runTool(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error !== undefined) {
    throw new RenderRegressionError(`cannot run ${command}: ${errorMessage(result.error)}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new RenderRegressionError(
      `${command} failed with exit code ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function normalizeText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}

function describeTextDifference(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < limit && actual[index] === expected[index]) {
    index += 1;
  }

  const line = actual.slice(0, index).split("\n").length;
  const actualLine = actual.split("\n")[line - 1] ?? "";
  const expectedLine = expected.split("\n")[line - 1] ?? "";
  return `first difference at line ${line}: expected ${JSON.stringify(expectedLine)}, received ${JSON.stringify(actualLine)}`;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
