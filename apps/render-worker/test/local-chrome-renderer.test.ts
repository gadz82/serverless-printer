import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LocalChromeRenderer,
  buildHtmlDocument,
  createPdfOptions,
  isAllowedRequestUrl,
  resolveChromeExecutable,
  type BlockedRequest,
} from "../src/rendering/local-chrome-renderer.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GENERIC_REPORT_DIRECTORY = path.join(REPOSITORY_ROOT, "templates", "generic-report");
const CHROME_EXECUTABLE = resolveChromeExecutable();
const MACOS_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (CHROME_EXECUTABLE === undefined) {
  console.warn(
    "Chrome not found; set CHROME_PATH or install Google Chrome. " +
      "Skipping the local Chrome browser tests.",
  );
}

describe("local Chrome renderer", () => {
  describe("page settings", () => {
    it("uses A4, background printing, CSS page size and tagged output", () => {
      const options = createPdfOptions();

      expect(options).toMatchObject({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        tagged: true,
        displayHeaderFooter: true,
        margin: {
          top: "20mm",
          right: "16mm",
          bottom: "18mm",
          left: "16mm",
        },
      });
      expect(options.headerTemplate).toContain("pageNumber");
      expect(options.headerTemplate).toContain("totalPages");
      expect(options.footerTemplate).toContain("pageNumber");
      expect(options.footerTemplate).toContain("totalPages");
    });

    it("lets the caller replace the header and footer templates", () => {
      const options = createPdfOptions({
        headerTemplate: "<div>Custom header</div>",
        footerTemplate: "<div>Custom footer</div>",
      });

      expect(options.headerTemplate).toBe("<div>Custom header</div>");
      expect(options.footerTemplate).toBe("<div>Custom footer</div>");
    });
  });

  describe("request policy", () => {
    it.each([
      "file:///tmp/templates/generic-report/styles.css",
      "data:text/css,body%7Bcolor%3Ablack%7D",
      "about:blank",
    ])("allows %s", (url) => {
      expect(isAllowedRequestUrl(url)).toBe(true);
    });

    it.each([
      "https://example.com/styles.css",
      "http://example.com/image.png",
      "ws://example.com/socket",
      "ftp://example.com/file",
      "javascript:alert(1)",
      "not a URL",
    ])("blocks %s", (url) => {
      expect(isAllowedRequestUrl(url)).toBe(false);
    });
  });

  describe("base document", () => {
    it("inserts a file base element into an existing head", () => {
      const baseHref = pathToFileURL(`${GENERIC_REPORT_DIRECTORY}${path.sep}`).href;
      const document = buildHtmlDocument(
        '<!doctype html><html lang="en"><head><title>Report</title></head><body></body></html>',
        GENERIC_REPORT_DIRECTORY,
      );

      expect(document).toContain(`<base href="${baseHref}" />`);
      expect(document.indexOf("<base")).toBeLessThan(document.indexOf("<title>"));
    });

    it("adds a head when the HTML fragment has none", () => {
      const document = buildHtmlDocument("<p>Fragment</p>", GENERIC_REPORT_DIRECTORY);

      expect(document).toContain("<head>");
      expect(document).toContain('<base href="file://');
      expect(document).toContain("<p>Fragment</p>");
    });
  });

  describe("Chrome resolution", () => {
    it("prefers CHROME_PATH", () => {
      expect(
        resolveChromeExecutable({
          env: { CHROME_PATH: "/custom/chrome" },
          platform: "darwin",
          exists: (candidate) => candidate === "/custom/chrome",
        }),
      ).toBe("/custom/chrome");
    });

    it("falls back to the macOS Chrome install", () => {
      expect(
        resolveChromeExecutable({
          env: {},
          platform: "darwin",
          exists: (candidate) => candidate === MACOS_CHROME_PATH,
        }),
      ).toBe(MACOS_CHROME_PATH);
    });

    it("returns undefined when no executable exists", () => {
      expect(
        resolveChromeExecutable({
          env: {},
          platform: "darwin",
          exists: () => false,
        }),
      ).toBeUndefined();
    });
  });

  it.skipIf(CHROME_EXECUTABLE === undefined)(
    "blocks external requests",
    { timeout: 30_000 },
    async () => {
      const blocked: BlockedRequest[] = [];
      const renderer = new LocalChromeRenderer({
        chromePath: CHROME_EXECUTABLE,
        onRequestBlocked: (request) => blocked.push(request),
      });

      const pdf = await renderer.render({
        html: [
          "<!doctype html>",
          '<html lang="en">',
          "  <head>",
          "    <title>Blocked request test</title>",
          '    <link rel="stylesheet" href="https://example.invalid/blocked.css" />',
          "  </head>",
          "  <body>",
          '    <img src="https://example.invalid/blocked.png" alt="Blocked request" />',
          "  </body>",
          "</html>",
        ].join("\n"),
        baseDirectory: GENERIC_REPORT_DIRECTORY,
      });

      expect(Buffer.from(pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(blocked.map((request) => request.url)).toContain(
        "https://example.invalid/blocked.css",
      );
      expect(blocked.map((request) => request.url)).toContain(
        "https://example.invalid/blocked.png",
      );
    },
  );

  it.skipIf(CHROME_EXECUTABLE === undefined)(
    "does not execute JavaScript",
    { timeout: 30_000 },
    async () => {
      const blocked: BlockedRequest[] = [];
      const renderer = new LocalChromeRenderer({
        chromePath: CHROME_EXECUTABLE,
        onRequestBlocked: (request) => blocked.push(request),
      });

      const pdf = await renderer.render({
        html: [
          "<!doctype html>",
          '<html lang="en">',
          "  <head>",
          "    <title>Static report</title>",
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

      expect(Buffer.from(pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(Buffer.from(pdf).toString("latin1")).not.toContain("JS_EXECUTED");
      expect(blocked.map((request) => request.url)).not.toContain(
        "https://example.invalid/js-ran.png",
      );
    },
  );

  it.skipIf(CHROME_EXECUTABLE === undefined)(
    "loads local stylesheets through the base element",
    { timeout: 30_000 },
    async () => {
      const templateDirectory = await mkdtemp(path.join(tmpdir(), "printer-local-css-"));
      try {
        await writeFile(
          path.join(templateDirectory, "index.html"),
          '<!doctype html><html lang="en"><body>File origin</body></html>',
          "utf8",
        );
        await writeFile(
          path.join(templateDirectory, "styles.css"),
          "@page { size: A5; margin: 10mm; }\n",
          "utf8",
        );

        const renderer = new LocalChromeRenderer({ chromePath: CHROME_EXECUTABLE });
        const pdf = await renderer.render({
          html: [
            "<!doctype html>",
            '<html lang="en">',
            "  <head>",
            '    <link rel="stylesheet" href="styles.css" />',
            "  </head>",
            "  <body>",
            "    <p>Styled content</p>",
            "  </body>",
            "</html>",
          ].join("\n"),
          baseDirectory: templateDirectory,
        });

        const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(Buffer.from(pdf).toString("latin1"))?.[1];
        expect(mediaBox).toBeDefined();
        if (mediaBox === undefined) {
          throw new Error("rendered PDF has no MediaBox");
        }

        const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = mediaBox
          .split(/\s+/)
          .map(Number);
        expect({ x, y }).toEqual({ x: 0, y: 0 });
        expect(width).toBeGreaterThan(400);
        expect(width).toBeLessThan(440);
        expect(height).toBeGreaterThan(580);
        expect(height).toBeLessThan(610);
      } finally {
        await rm(templateDirectory, { recursive: true, force: true });
      }
    },
  );
});
