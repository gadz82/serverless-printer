import { PdfRenderFailed } from "@printer/domain";
import { ProtocolError } from "puppeteer-core";

import { createPdfOptions } from "./page-settings.js";
import {
  renderHtmlOnPage,
  type HtmlRenderInput,
  type RenderingBrowser,
  type RenderingPage,
} from "./render-page.js";
import type { BlockedRequest } from "./request-policy.js";

export const DEFAULT_RENDER_TIMEOUT_MS = 50_000;
// Keep the worst-case 50 s render deadline plus page and browser cleanup
// comfortably below the 60 s Lambda function timeout.
export const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

export type ChromiumPdfRenderInput = HtmlRenderInput;

export type ChromiumPdfRendererOptions = {
  /**
   * Test seam: local Chrome and tests can supply the browser factory. The
   * default launches the bundled Lambda Chromium exactly once per instance.
   */
  readonly launchBrowser?: () => Promise<RenderingBrowser>;
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  /**
   * Whole-render deadline, including launch, page creation, rendering and the
   * crash retry. It stays below the Lambda 60 s function timeout.
   */
  readonly timeoutMs?: number;
  /** Bound for closing a page or browser; cleanup never waits forever. */
  readonly closeTimeoutMs?: number;
  readonly onRequestBlocked?: (request: BlockedRequest) => void;
  readonly onRequestError?: (error: unknown) => void;
};

class RenderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Chromium PDF render timed out after ${String(timeoutMs)} ms`);
    this.name = "RenderTimeoutError";
  }
}

/**
 * Renders compiled template HTML to PDF with the bundled Lambda Chromium.
 *
 * The browser is launched lazily and reused for every job on the instance; a
 * page is created per job and always closed with a deadline. After a browser,
 * page or protocol crash the browser is discarded and the job is retried once
 * with a fresh launch.
 */
export class ChromiumPdfRenderer {
  private readonly launchBrowser: () => Promise<RenderingBrowser>;
  private readonly timeoutMs: number;
  private readonly closeTimeoutMs: number;
  private browserPromise: Promise<RenderingBrowser> | undefined;

  constructor(private readonly options: ChromiumPdfRendererOptions = {}) {
    this.launchBrowser = options.launchBrowser ?? launchServerlessChromium;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  }

  async render(input: ChromiumPdfRenderInput): Promise<Uint8Array> {
    const deadline = Date.now() + this.timeoutMs;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let browser: RenderingBrowser | undefined;
      let page: RenderingPage | undefined;
      let pageCrashed = false;

      try {
        browser = await this.launchWithinDeadline(deadline);
        page = await this.withinDeadline(browser.newPage(), deadline);
        page.on("error", () => {
          pageCrashed = true;
        });

        return await this.withinDeadline(
          renderHtmlOnPage(page, input, {
            pdfOptions: createPdfOptions({
              headerTemplate: this.options.headerTemplate,
              footerTemplate: this.options.footerTemplate,
            }),
            timeoutMs: this.remainingMs(deadline),
            fileRoots: [input.baseDirectory],
            onRequestBlocked: this.options.onRequestBlocked,
            onRequestError: this.options.onRequestError,
          }),
          deadline,
        );
      } catch (error) {
        lastError = error;
        const timedOut = error instanceof RenderTimeoutError;
        const pageFailed = pageCrashed || isPageCrashError(error);
        const unusable =
          browser !== undefined && (timedOut || pageFailed || !isBrowserUsable(browser, page));

        if (unusable && browser !== undefined) {
          await this.discardBrowser(browser);
        }

        if (!timedOut && unusable && attempt === 0 && Date.now() < deadline) {
          continue;
        }

        throw asPdfRenderFailed(error, this.timeoutMs);
      } finally {
        if (page !== undefined) {
          await this.closePage(page);
        }
      }
    }

    throw asPdfRenderFailed(lastError, this.timeoutMs);
  }

  /**
   * Closes the instance browser with a deadline. Lambda can call this on
   * shutdown; the next render launches a fresh browser.
   */
  async close(): Promise<void> {
    const pending = this.browserPromise;
    this.browserPromise = undefined;
    if (pending === undefined) {
      return;
    }

    const browser = await withTimeout(pending, this.closeTimeoutMs, this.closeTimeoutMs).catch(
      () => undefined,
    );
    if (browser !== undefined) {
      await this.closeBrowser(browser);
    }
  }

  private async launchWithinDeadline(deadline: number): Promise<RenderingBrowser> {
    const pending = this.getBrowser();
    try {
      return await this.withinDeadline(pending, deadline);
    } catch (error) {
      if (error instanceof RenderTimeoutError) {
        this.abandonBrowserLaunch();
      }
      throw error;
    }
  }

  private abandonBrowserLaunch(): void {
    const pending = this.browserPromise;
    this.browserPromise = undefined;
    if (pending === undefined) {
      return;
    }

    // A timed-out launch cannot be cancelled. Close the browser if it appears
    // later; the render itself has already failed.
    void pending.then((browser) => this.closeBrowser(browser)).catch(() => undefined);
  }

  private async getBrowser(): Promise<RenderingBrowser> {
    const current = this.browserPromise;
    if (current !== undefined) {
      const browser = await current.catch(() => undefined);
      if (browser !== undefined && browser.connected) {
        return browser;
      }
      if (browser !== undefined) {
        await this.discardBrowser(browser);
      }
    }

    const pending = this.launchBrowser();
    this.browserPromise = pending;
    try {
      return await pending;
    } catch (error) {
      if (this.browserPromise === pending) {
        this.browserPromise = undefined;
      }
      throw error;
    }
  }

  private async discardBrowser(browser: RenderingBrowser): Promise<void> {
    const pending = this.browserPromise;
    if (pending !== undefined) {
      const current = await withTimeout(pending, this.closeTimeoutMs, this.closeTimeoutMs).catch(
        () => undefined,
      );
      if (current === browser) {
        this.browserPromise = undefined;
      }
    }

    await this.closeBrowser(browser);
  }

  private async closeBrowser(browser: RenderingBrowser): Promise<void> {
    // A disconnected browser has already lost its process; close() would only
    // reject or hang.
    if (!browser.connected) {
      return;
    }

    await closeQuietly(() => browser.close(), this.closeTimeoutMs);
  }

  private async closePage(page: RenderingPage): Promise<void> {
    await closeQuietly(() => page.close(), this.closeTimeoutMs);
  }

  private withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
    return withTimeout(operation, this.remainingMs(deadline), this.timeoutMs);
  }

  private remainingMs(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RenderTimeoutError(this.timeoutMs);
    }
    return remaining;
  }
}

async function launchServerlessChromium(): Promise<RenderingBrowser> {
  // Load the Lambda browser package only when a real launch is needed, so
  // preview and unit tests never unpack the bundled Chromium binary.
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);
  const executablePath = await chromium.executablePath();
  const args = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
  const browser = await puppeteer.launch({
    args: [...args, "--allow-file-access-from-files"],
    executablePath,
    headless: "shell",
  });

  return browser as RenderingBrowser;
}

function isBrowserUsable(browser: RenderingBrowser, page: RenderingPage | undefined): boolean {
  return browser.connected && page?.isClosed() !== true;
}

function isPageCrashError(error: unknown): boolean {
  // TargetCloseError and ConnectionClosedError both extend ProtocolError.
  return error instanceof ProtocolError;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  configuredTimeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RenderTimeoutError(configuredTimeoutMs));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function closeQuietly(close: () => Promise<void>, timeoutMs: number): Promise<void> {
  try {
    await withTimeout(close(), timeoutMs, timeoutMs);
  } catch {
    // Cleanup is best effort and must not mask the original render result or
    // error when closing a page/browser fails or times out.
  }
}

function asPdfRenderFailed(error: unknown, timeoutMs: number): PdfRenderFailed {
  if (error instanceof PdfRenderFailed) {
    return error;
  }

  const message =
    error instanceof RenderTimeoutError
      ? `Chromium PDF render timed out after ${String(timeoutMs)} ms`
      : `Chromium PDF render failed: ${errorMessage(error)}`;

  return new PdfRenderFailed(message, { cause: error });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
