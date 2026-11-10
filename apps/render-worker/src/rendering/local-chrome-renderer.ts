import { existsSync } from "node:fs";

import puppeteer from "puppeteer-core";

import { buildHtmlDocument } from "./html-document.js";
import {
  DEFAULT_FOOTER_TEMPLATE,
  DEFAULT_HEADER_TEMPLATE,
  createPdfOptions,
  type PdfOptionsOverrides,
} from "./page-settings.js";
import { renderHtmlOnPage, type HtmlRenderInput, type RenderingBrowser } from "./render-page.js";
import { isAllowedRequestUrl, type BlockedRequest } from "./request-policy.js";

export {
  buildHtmlDocument,
  createPdfOptions,
  DEFAULT_FOOTER_TEMPLATE,
  DEFAULT_HEADER_TEMPLATE,
  isAllowedRequestUrl,
};
export type { BlockedRequest, PdfOptionsOverrides };

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

export type LocalChromeRenderInput = HtmlRenderInput;

export type LocalChromeBrowserLauncher = (executablePath: string) => Promise<RenderingBrowser>;

export type LocalChromeRendererOptions = {
  readonly chromePath?: string;
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  /** Test seam: local Chrome is launched with puppeteer-core by default. */
  readonly launchBrowser?: LocalChromeBrowserLauncher;
  readonly onRequestBlocked?: (request: BlockedRequest) => void;
  /** Receives request continue/abort failures; the default logs them. */
  readonly onRequestError?: (error: unknown) => void;
  /** Receives browser close failures; the default logs them. */
  readonly onBrowserCloseError?: (error: unknown) => void;
};

export type ResolveChromeExecutableOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (candidate: string) => boolean;
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

export class ChromePathError extends Error {
  constructor(readonly configuredPath: string) {
    super(
      `CHROME_PATH is set to "${configuredPath}" but no executable exists at that path. ` +
        "Fix CHROME_PATH or unset it to use an installed Chrome.",
    );
    this.name = "ChromePathError";
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
 * Finds an installed Chrome without downloading one. CHROME_PATH wins, then
 * the platform defaults used by local development. A configured CHROME_PATH
 * that does not exist is a configuration error, never a reason to fall back.
 */
export function resolveChromeExecutable(
  options: ResolveChromeExecutableOptions = {},
): string | undefined {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const configured = env["CHROME_PATH"]?.trim();

  if (configured !== undefined && configured.length > 0) {
    if (!exists(configured)) {
      throw new ChromePathError(configured);
    }
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
// ORCHID-MEM: 01a1c51f-4103-7564-a29a-ff3468f66402 — Renders one compiled HTML document to PDF with an installed local Chrome.
export class LocalChromeRenderer {
  constructor(private readonly options: LocalChromeRendererOptions = {}) {}

  async render(input: LocalChromeRenderInput): Promise<Uint8Array> {
    const executablePath = this.options.chromePath ?? resolveChromeExecutable();
    if (executablePath === undefined) {
      throw new ChromeNotFoundError();
    }

    let browser: RenderingBrowser;
    try {
      browser = await (this.options.launchBrowser ?? launchLocalChrome)(executablePath);
    } catch (error) {
      throw new ChromeLaunchError(executablePath, error);
    }

    try {
      const page = await browser.newPage();

      try {
        return await renderHtmlOnPage(page, input, {
          pdfOptions: createPdfOptions({
            headerTemplate: this.options.headerTemplate,
            footerTemplate: this.options.footerTemplate,
          }),
          timeoutMs: 60_000,
          fileRoots: [input.baseDirectory],
          onRequestBlocked: this.options.onRequestBlocked,
          onRequestError: this.options.onRequestError ?? logRequestInterceptionError,
        });
      } catch (error) {
        throw new LocalChromeRenderError(
          `Chrome failed to render the HTML document: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    } finally {
      // Close failures must never replace the render result or error. They are
      // still reported through the callback/default log.
      await closeBrowserQuietly(browser, this.options.onBrowserCloseError);
    }
  }
}

async function launchLocalChrome(executablePath: string): Promise<RenderingBrowser> {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: CHROME_ARGUMENTS,
  });

  return browser as unknown as RenderingBrowser;
}

async function closeBrowserQuietly(
  browser: RenderingBrowser,
  onBrowserCloseError: ((error: unknown) => void) | undefined,
): Promise<void> {
  try {
    await browser.close();
  } catch (error) {
    (onBrowserCloseError ?? logBrowserCloseError)(error);
  }
}

function logRequestInterceptionError(error: unknown): void {
  console.warn(`Chrome request interception failed: ${safeErrorDetail(error)}`);
}

function logBrowserCloseError(error: unknown): void {
  console.warn(`Chrome browser close failed: ${safeErrorDetail(error)}`);
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Error messages can quote a request URL; redact every URL before logging.
 */
function safeErrorDetail(error: unknown): string {
  const name = error instanceof Error ? error.name : "unknown error";
  const message = errorMessage(error).replaceAll(URL_PATTERN, "[redacted-url]");
  return message.length > 0 ? `${name}: ${message}` : name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
