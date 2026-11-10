import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { PDFOptions } from "puppeteer-core";

import { buildHtmlDocument, directoryToFileUrl } from "./html-document.js";
import { isAllowedRequestUrl, type BlockedRequest } from "./request-policy.js";

export type RenderingRequest = {
  url(): string;
  resourceType(): string;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
};

export type RenderingPage = {
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: "request", listener: (request: RenderingRequest) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  setContent(html: string, options: { waitUntil: "load"; timeout: number }): Promise<void>;
  pdf(options: PDFOptions): Promise<Uint8Array>;
  close(): Promise<void>;
  isClosed(): boolean;
};

export type RenderingBrowser = {
  readonly connected: boolean;
  newPage(): Promise<RenderingPage>;
  close(): Promise<void>;
};

export type HtmlRenderInput = {
  readonly html: string;
  readonly baseDirectory: string;
};

export type PagePreparationOptions = {
  readonly fileRoots: readonly string[];
  readonly onRequestBlocked?: (request: BlockedRequest) => void;
  readonly onRequestError?: (error: unknown) => void;
};

export type HtmlRenderOptions = PagePreparationOptions & {
  readonly pdfOptions: PDFOptions;
  readonly timeoutMs: number;
};

/**
 * Applies the renderer isolation policy shared by local Chrome and Lambda.
 * JavaScript is disabled before the document loads, and request interception
 * allows only bundled files, embedded data and the initial blank document.
 */
export async function preparePageForRendering(
  page: RenderingPage,
  options: PagePreparationOptions,
): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();

    if (isAllowedRequestUrl(url, { fileRoots: options.fileRoots })) {
      void request.continue().catch((error: unknown) => options.onRequestError?.(error));
      return;
    }

    options.onRequestBlocked?.({
      url,
      resourceType: request.resourceType(),
    });
    void request
      .abort("blockedbyclient")
      .catch((error: unknown) => options.onRequestError?.(error));
  });
}

/**
 * Loads the compiled document from a file origin so its relative stylesheets
 * and assets resolve, then prints it with the shared PDF settings.
 */
export async function renderHtmlOnPage(
  page: RenderingPage,
  input: HtmlRenderInput,
  options: HtmlRenderOptions,
): Promise<Uint8Array> {
  page.setDefaultTimeout(options.timeoutMs);
  page.setDefaultNavigationTimeout(options.timeoutMs);
  await preparePageForRendering(page, options);
  await openFileOrigin(page, input.baseDirectory, options.timeoutMs);
  await page.setContent(buildHtmlDocument(input.html, input.baseDirectory), {
    waitUntil: "load",
    timeout: options.timeoutMs,
  });

  return page.pdf(options.pdfOptions);
}

async function openFileOrigin(
  page: RenderingPage,
  baseDirectory: string,
  timeoutMs: number,
): Promise<void> {
  const absoluteDirectory = path.resolve(baseDirectory);
  const indexFile = path.join(absoluteDirectory, "index.html");
  const originUrl = existsSync(indexFile)
    ? pathToFileURL(indexFile).href
    : directoryToFileUrl(absoluteDirectory);

  try {
    await page.goto(originUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch {
    // A template folder without a readable index still needs a file origin for
    // its relative assets; the directory URL stays inside the allowed root.
    await page.goto(directoryToFileUrl(absoluteDirectory), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  }
}
