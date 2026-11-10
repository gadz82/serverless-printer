import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import puppeteer, { type Browser, type Page, type PDFOptions } from "puppeteer-core";

/**
 * Headers and footers are rendered in Chrome's margin boxes. They must carry
 * their own inline styles because the template's print stylesheet does not
 * apply to them.
 */
export const DEFAULT_HEADER_TEMPLATE =
  '<div style="box-sizing: border-box; color: #52606d; display: flex; font-size: 8px; justify-content: space-between; padding: 0 16mm; width: 100%;">' +
  '<span class="title"></span>' +
  '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
  "</div>";

export const DEFAULT_FOOTER_TEMPLATE =
  '<div style="box-sizing: border-box; color: #52606d; display: flex; font-size: 8px; justify-content: space-between; padding: 0 16mm; width: 100%;">' +
  "<span>Printer</span>" +
  '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
  "</div>";

const PAGE_MARGIN = {
  top: "20mm",
  right: "16mm",
  bottom: "18mm",
  left: "16mm",
} as const;

const CHROME_ARGUMENTS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  // The document is supplied through setContent(), but it must keep a file:
  // origin so stylesheets resolved through the template <base> are readable.
  "--allow-file-access-from-files",
];

const DEFAULT_CHROME_PATHS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

export type LocalChromeRenderInput = {
  readonly html: string;
  readonly baseDirectory: string;
};

export type BlockedRequest = {
  readonly url: string;
  readonly resourceType: string;
};

export type LocalChromeRendererOptions = {
  readonly chromePath?: string;
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  readonly onRequestBlocked?: (request: BlockedRequest) => void;
};

export type ResolveChromeExecutableOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (candidate: string) => boolean;
};

export type PdfOptionsOverrides = {
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
};

export class ChromeNotFoundError extends Error {
  constructor() {
    super(
      "Google Chrome executable not found. Set CHROME_PATH to an installed Chrome or install " +
        "Google Chrome in the default location.",
    );
    this.name = "ChromeNotFoundError";
  }
}

export class ChromeLaunchError extends Error {
  constructor(executablePath: string, cause: unknown) {
    super(`cannot launch Chrome at ${executablePath}: ${errorMessage(cause)}`, { cause });
    this.name = "ChromeLaunchError";
  }
}

export class LocalChromeRenderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalChromeRenderError";
  }
}

/**
 * Returns the same PDF settings the Lambda renderer will use.
 */
export function createPdfOptions(overrides: PdfOptionsOverrides = {}): PDFOptions {
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: overrides.headerTemplate ?? DEFAULT_HEADER_TEMPLATE,
    footerTemplate: overrides.footerTemplate ?? DEFAULT_FOOTER_TEMPLATE,
    margin: { ...PAGE_MARGIN },
  };
}

/**
 * The renderer may load bundled template files, embedded data and the blank
 * document only. Every network scheme is rejected before Chrome requests it.
 */
export function isAllowedRequestUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return parsed.protocol === "file:" || parsed.protocol === "data:" || parsed.protocol === "about:";
}

/**
 * Inserts a <base> so relative stylesheet and asset URLs resolve inside the
 * template folder while the document itself is supplied through setContent().
 */
export function buildHtmlDocument(html: string, baseDirectory: string): string {
  const baseElement = `<base href="${escapeHtmlAttribute(directoryToFileUrl(baseDirectory))}" />`;
  const headPattern = /<head\b[^>]*>/i;

  if (headPattern.test(html)) {
    return html.replace(headPattern, (head) => `${head}\n    ${baseElement}`);
  }

  const htmlPattern = /<html\b[^>]*>/i;
  if (htmlPattern.test(html)) {
    return html.replace(
      htmlPattern,
      (htmlTag) => `${htmlTag}\n  <head>\n    ${baseElement}\n  </head>`,
    );
  }

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    `    ${baseElement}`,
    "  </head>",
    "  <body>",
    html,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Finds an installed Chrome without downloading one. CHROME_PATH wins, then
 * the platform defaults used by local development.
 */
export function resolveChromeExecutable(
  options: ResolveChromeExecutableOptions = {},
): string | undefined {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const configured = env["CHROME_PATH"]?.trim();

  if (configured !== undefined && configured.length > 0 && exists(configured)) {
    return configured;
  }

  for (const candidate of DEFAULT_CHROME_PATHS[platform] ?? []) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Renders one compiled HTML document with a locally installed Chrome.
 *
 * A browser is launched for each call and always closed in `finally`, so a
 * preview cannot leak Chrome processes. The caller owns template lookup and
 * Handlebars compilation; this adapter only owns browser isolation and PDF
 * page settings.
 */
export class LocalChromeRenderer {
  constructor(private readonly options: LocalChromeRendererOptions = {}) {}

  async render(input: LocalChromeRenderInput): Promise<Uint8Array> {
    const executablePath = this.options.chromePath ?? resolveChromeExecutable();
    if (executablePath === undefined) {
      throw new ChromeNotFoundError();
    }

    let browser: Browser | undefined;
    try {
      try {
        browser = await puppeteer.launch({
          executablePath,
          headless: true,
          args: CHROME_ARGUMENTS,
        });
      } catch (error) {
        throw new ChromeLaunchError(executablePath, error);
      }

      const page = await browser.newPage();
      await this.preparePage(page);

      try {
        // setContent() keeps the current document URL and origin. Starting on
        // a file: document lets the template <base> load local CSS, which an
        // about:blank document would reject as a local-resource request.
        await this.openFileOrigin(page, input.baseDirectory);
        await page.setContent(buildHtmlDocument(input.html, input.baseDirectory), {
          waitUntil: "load",
        });

        return await page.pdf(
          createPdfOptions({
            headerTemplate: this.options.headerTemplate,
            footerTemplate: this.options.footerTemplate,
          }),
        );
      } catch (error) {
        throw new LocalChromeRenderError(
          `Chrome failed to render the HTML document: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    } finally {
      if (browser !== undefined) {
        await browser.close();
      }
    }
  }

  private async preparePage(page: Page): Promise<void> {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();

      if (isAllowedRequestUrl(url)) {
        void request.continue().catch(() => undefined);
        return;
      }

      this.options.onRequestBlocked?.({
        url,
        resourceType: request.resourceType(),
      });
      void request.abort("blockedbyclient").catch(() => undefined);
    });
  }

  private async openFileOrigin(page: Page, baseDirectory: string): Promise<void> {
    const absoluteDirectory = path.resolve(baseDirectory);
    const indexFile = path.join(absoluteDirectory, "index.html");
    const originUrl = existsSync(indexFile)
      ? pathToFileURL(indexFile).href
      : directoryToFileUrl(absoluteDirectory);

    try {
      await page.goto(originUrl, { waitUntil: "domcontentloaded" });
    } catch {
      await page.goto("file:///", { waitUntil: "domcontentloaded" });
    }
  }
}

function directoryToFileUrl(directory: string): string {
  const absoluteDirectory = path.resolve(directory);
  const withTrailingSeparator = absoluteDirectory.endsWith(path.sep)
    ? absoluteDirectory
    : `${absoluteDirectory}${path.sep}`;

  return pathToFileURL(withTrailingSeparator).href;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
