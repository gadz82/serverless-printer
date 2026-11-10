import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";

import { ChromiumPdfRenderer } from "../src/rendering/chromium-pdf-renderer.js";
import {
  resolveChromeExecutable,
  type LocalChromeRenderInput,
} from "../src/rendering/local-chrome-renderer.js";
import type { RenderingBrowser } from "../src/rendering/render-page.js";
import type { BlockedRequest } from "../src/rendering/request-policy.js";
import { loadTemplateCompiler } from "./renderer-template.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GENERIC_REPORT_DIRECTORY = path.join(REPOSITORY_ROOT, "templates", "generic-report");
const CHROME_EXECUTABLE = resolveChromeExecutable();

if (CHROME_EXECUTABLE === undefined) {
  console.warn(
    "Chrome not found; set CHROME_PATH or install Google Chrome. " +
      "Skipping the Chromium renderer integration tests.",
  );
}

function launchLocalChrome(): Promise<RenderingBrowser> {
  if (CHROME_EXECUTABLE === undefined) {
    throw new Error("Chrome executable is unavailable");
  }

  return puppeteer
    .launch({
      executablePath: CHROME_EXECUTABLE,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"],
    })
    .then((browser) => browser as unknown as RenderingBrowser);
}

async function compileGenericReport(): Promise<LocalChromeRenderInput> {
  const [source, sampleSource] = await Promise.all([
    readFile(path.join(GENERIC_REPORT_DIRECTORY, "index.html"), "utf8"),
    readFile(path.join(GENERIC_REPORT_DIRECTORY, "sample.json"), "utf8"),
  ]);
  const sample: unknown = JSON.parse(sampleSource);
  if (typeof sample !== "object" || sample === null || Array.isArray(sample)) {
    throw new Error("generic-report sample.json must contain an object");
  }

  const compiler = await loadTemplateCompiler(REPOSITORY_ROOT);
  const html = compiler.compileTemplate(source, { mode: "lenient" })(
    sample as Readonly<Record<string, unknown>>,
  );

  return { html, baseDirectory: GENERIC_REPORT_DIRECTORY };
}

describe.skipIf(CHROME_EXECUTABLE === undefined)("ChromiumPdfRenderer with local Chrome", () => {
  it("renders a valid PDF for the generic-report template", { timeout: 60_000 }, async () => {
    const input = await compileGenericReport();
    const renderer = new ChromiumPdfRenderer({ launchBrowser: launchLocalChrome });

    try {
      const pdf = await renderer.render(input);
      expect(Buffer.from(pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBe(1);
      expect(document.getTitle()).toBe("Quarterly business report");
      expect(document.getCreator()).toMatch(/HeadlessChrome|Chrome|Chromium/);
    } finally {
      await renderer.close();
    }
  });

  it("keeps JavaScript disabled and blocks external requests", { timeout: 60_000 }, async () => {
    const blocked: BlockedRequest[] = [];
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: launchLocalChrome,
      onRequestBlocked: (request) => blocked.push(request),
    });

    try {
      const pdf = await renderer.render({
        html: [
          "<!doctype html>",
          '<html lang="en">',
          "  <head>",
          "    <title>StaticTitle</title>",
          '    <link rel="stylesheet" href="https://example.invalid/blocked.css" />',
          "  </head>",
          "  <body>",
          "    <p>Static content</p>",
          "    <script>",
          '      document.title = "JS_EXECUTED";',
          '      const image = document.createElement("img");',
          '      image.src = "https://example.invalid/js-ran.png";',
          "      document.body.appendChild(image);",
          "    </script>",
          "  </body>",
          "</html>",
        ].join("\n"),
        baseDirectory: GENERIC_REPORT_DIRECTORY,
      });
      const document = await PDFDocument.load(pdf);

      expect(Buffer.from(pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(document.getTitle()).toBe("StaticTitle");
      expect(blocked.map((request) => request.url)).toContain(
        "https://example.invalid/blocked.css",
      );
      expect(blocked.map((request) => request.url)).not.toContain(
        "https://example.invalid/js-ran.png",
      );
    } finally {
      await renderer.close();
    }
  });
});
