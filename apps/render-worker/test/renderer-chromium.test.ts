import path from "node:path";

import { PdfRenderFailed } from "@printer/domain";
import { ProtocolError } from "puppeteer-core";
import { describe, expect, it } from "vitest";

import {
  ChromiumPdfRenderer,
  DEFAULT_RENDER_TIMEOUT_MS,
} from "../src/rendering/chromium-pdf-renderer.js";
import type { HtmlRenderInput, RenderingBrowser } from "../src/rendering/render-page.js";
import type { BlockedRequest } from "../src/rendering/request-policy.js";
import { FAKE_PDF_BYTES, FakeBrowser, FakePage, FakeRequest } from "./renderer-fakes.js";

const RENDER_INPUT: HtmlRenderInput = {
  html: "<!doctype html><html><body><p>Report</p></body></html>",
  baseDirectory: path.join(process.cwd(), "templates", "generic-report"),
};

function pdfHeader(bytes: Uint8Array): string {
  return Buffer.from(bytes).subarray(0, 5).toString("latin1");
}

async function renderFailure(renderer: ChromiumPdfRenderer): Promise<unknown> {
  try {
    await renderer.render(RENDER_INPUT);
    throw new Error("render unexpectedly succeeded");
  } catch (error) {
    return error;
  }
}

describe("ChromiumPdfRenderer lifecycle", () => {
  it("defaults to a render deadline below the Lambda function timeout", () => {
    expect(DEFAULT_RENDER_TIMEOUT_MS).toBe(50_000);
    expect(DEFAULT_RENDER_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("launches once per instance, opens one page per job and closes each page", async () => {
    const launches: FakeBrowser[] = [];
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        const browser = new FakeBrowser();
        launches.push(browser);
        return browser;
      },
    });

    const first = await renderer.render(RENDER_INPUT);
    const second = await renderer.render(RENDER_INPUT);

    expect(pdfHeader(first)).toBe("%PDF-");
    expect(pdfHeader(second)).toBe("%PDF-");
    expect(launches).toHaveLength(1);
    const browser = launches[0];
    expect(browser?.pages).toHaveLength(2);
    expect(browser?.pages.every((page) => page.closed)).toBe(true);
    expect(browser?.closeCount).toBe(0);

    await renderer.close();
    expect(browser?.closeCount).toBe(1);
  });

  it("reuses the browser but relaunches after it disconnects between jobs", async () => {
    const launches: FakeBrowser[] = [];
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        const browser = new FakeBrowser();
        launches.push(browser);
        return browser;
      },
    });

    await renderer.render(RENDER_INPUT);
    const firstBrowser = launches[0];
    if (firstBrowser === undefined) {
      throw new Error("first browser was not launched");
    }
    firstBrowser.connected = false;

    await renderer.render(RENDER_INPUT);

    expect(launches).toHaveLength(2);
    expect(firstBrowser.closeCount).toBe(0);
    expect(launches[1]?.pages).toHaveLength(1);
    expect(launches[1]?.pages[0]?.closed).toBe(true);
  });

  it("relaunches and retries once when the browser crashes during a job", async () => {
    const launches: FakeBrowser[] = [];
    const firstBrowser = new FakeBrowser((pageIndex) => {
      if (pageIndex === 0) {
        return new FakePage();
      }

      return new FakePage({
        pdf: async () => {
          firstBrowser.connected = false;
          throw new Error("Target closed");
        },
      });
    });

    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        if (launches.length === 0) {
          launches.push(firstBrowser);
          return firstBrowser;
        }

        const browser = new FakeBrowser();
        launches.push(browser);
        return browser;
      },
    });

    await renderer.render(RENDER_INPUT);
    const recovered = await renderer.render(RENDER_INPUT);

    expect(pdfHeader(recovered)).toBe("%PDF-");
    expect(launches).toHaveLength(2);
    expect(firstBrowser.closeCount).toBe(0);
    expect(firstBrowser.pages).toHaveLength(2);
    expect(firstBrowser.pages.every((page) => page.closed)).toBe(true);
    expect(launches[1]?.pages[0]?.closed).toBe(true);
  });

  it("relaunches and retries once on a target-closed protocol error while still connected", async () => {
    const launches: FakeBrowser[] = [];
    const firstBrowser = new FakeBrowser(
      (pageIndex) => {
        if (pageIndex === 0) {
          return new FakePage();
        }

        return new FakePage({
          pdf: async () => {
            throw new ProtocolError("Target closed");
          },
        });
      },
      { close: () => new Promise<void>(() => undefined) },
    );

    const renderer = new ChromiumPdfRenderer({
      closeTimeoutMs: 20,
      launchBrowser: async () => {
        if (launches.length === 0) {
          launches.push(firstBrowser);
          return firstBrowser;
        }

        const browser = new FakeBrowser();
        launches.push(browser);
        return browser;
      },
    });

    await renderer.render(RENDER_INPUT);
    const recovered = await renderer.render(RENDER_INPUT);

    expect(pdfHeader(recovered)).toBe("%PDF-");
    expect(launches).toHaveLength(2);
    expect(firstBrowser.closeCount).toBe(1);
    expect(firstBrowser.pages).toHaveLength(2);
    expect(firstBrowser.pages.every((page) => page.closed)).toBe(true);
    expect(launches[1]?.pages[0]?.closed).toBe(true);
  });

  it("relaunches and retries once when the page emits a crash event", async () => {
    const launches: FakeBrowser[] = [];
    const firstBrowser = new FakeBrowser((pageIndex) => {
      if (pageIndex === 0) {
        return new FakePage();
      }

      const page = new FakePage({
        pdf: async () => {
          page.emitError(new Error("Page crashed!"));
          throw new Error("render aborted");
        },
      });
      return page;
    });

    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        if (launches.length === 0) {
          launches.push(firstBrowser);
          return firstBrowser;
        }

        const browser = new FakeBrowser();
        launches.push(browser);
        return browser;
      },
    });

    await renderer.render(RENDER_INPUT);
    const recovered = await renderer.render(RENDER_INPUT);

    expect(pdfHeader(recovered)).toBe("%PDF-");
    expect(launches).toHaveLength(2);
    expect(firstBrowser.closeCount).toBe(1);
    expect(launches[1]?.pages[0]?.closed).toBe(true);
  });

  it("disables JavaScript and blocks external requests", async () => {
    const blocked: BlockedRequest[] = [];
    const browser = new FakeBrowser();
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => browser,
      onRequestBlocked: (request) => blocked.push(request),
    });

    await renderer.render(RENDER_INPUT);
    const page = browser.pages[0];
    if (page === undefined) {
      throw new Error("renderer did not create a page");
    }

    expect(page.javascriptEnabled).toBe(false);
    expect(page.requestInterception).toBe(true);

    page.emitRequest(new FakeRequest("https://example.invalid/blocked.png", "image"));

    expect(blocked).toEqual([
      { url: "https://example.invalid/blocked.png", resourceType: "image" },
    ]);
    expect(page.pdfOptions[0]).toMatchObject({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
    });
  });

  it("closes the page but keeps the browser after a non-crash render failure", async () => {
    const browser = new FakeBrowser(
      () =>
        new FakePage({
          pdf: async () => {
            throw new Error("printer exploded");
          },
        }),
    );
    const renderer = new ChromiumPdfRenderer({ launchBrowser: async () => browser });

    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect(error).toMatchObject({
      code: "PDF_RENDER_FAILED",
      retryable: true,
    });
    expect((error as Error).message).toContain("printer exploded");
    expect(browser.pages[0]?.closed).toBe(true);
    expect(browser.closeCount).toBe(0);
  });

  it("maps launch failures to a retryable PDF_RENDER_FAILED", async () => {
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        throw new Error("bundled Chromium is missing");
      },
    });

    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect(error).toMatchObject({ code: "PDF_RENDER_FAILED", retryable: true });
    expect((error as Error).message).toContain("bundled Chromium is missing");
  });

  it("times out, discards the browser and does not retry the timed-out job", async () => {
    let launchCount = 0;
    const browsers: FakeBrowser[] = [];
    const renderer = new ChromiumPdfRenderer({
      timeoutMs: 20,
      launchBrowser: async () => {
        launchCount += 1;
        const browser = new FakeBrowser(
          () =>
            new FakePage({
              pdf: async () => new Promise<Uint8Array>(() => undefined),
            }),
        );
        browsers.push(browser);
        return browser;
      },
    });

    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect(error).toMatchObject({ code: "PDF_RENDER_FAILED", retryable: true });
    expect((error as Error).message).toContain("timed out after 20 ms");
    expect(launchCount).toBe(1);
    expect(browsers[0]?.pages[0]?.closed).toBe(true);
    expect(browsers[0]?.closeCount).toBe(1);
  });

  it("times out a launch that never resolves without blocking close", async () => {
    const renderer = new ChromiumPdfRenderer({
      timeoutMs: 20,
      closeTimeoutMs: 20,
      launchBrowser: () => new Promise<RenderingBrowser>(() => undefined),
    });

    const startedAt = Date.now();
    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect((error as Error).message).toContain("timed out after 20 ms");
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    await expect(renderer.close()).resolves.toBeUndefined();
  });

  it("times out page creation and closes the browser", async () => {
    let closeCount = 0;
    const browser: RenderingBrowser = {
      connected: true,
      newPage: () => new Promise(() => undefined),
      close: async () => {
        closeCount += 1;
      },
    };
    const renderer = new ChromiumPdfRenderer({
      timeoutMs: 20,
      closeTimeoutMs: 20,
      launchBrowser: async () => browser,
    });

    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect((error as Error).message).toContain("timed out after 20 ms");
    expect(closeCount).toBe(1);
  });

  it("preserves the original render error when page cleanup times out", async () => {
    const page = new FakePage({
      pdf: async () => {
        throw new Error("printer exploded");
      },
      close: () => new Promise<void>(() => undefined),
    });
    const browser = new FakeBrowser(() => page);
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => browser,
      closeTimeoutMs: 20,
    });

    const error = await renderFailure(renderer);

    expect(error).toBeInstanceOf(PdfRenderFailed);
    expect((error as Error).message).toContain("printer exploded");
    expect((error as Error).message).not.toContain("timed out");
    expect(page.closeCount).toBe(1);
  });

  it("bounds close when the browser close never resolves", async () => {
    const browser = new FakeBrowser(() => new FakePage(), {
      close: () => new Promise<void>(() => undefined),
    });
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => browser,
      closeTimeoutMs: 20,
    });

    await renderer.render(RENDER_INPUT);
    const startedAt = Date.now();
    await expect(renderer.close()).resolves.toBeUndefined();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(browser.closeCount).toBe(1);
  });

  it("closes the instance browser and launches again on the next render", async () => {
    let launchCount = 0;
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => {
        launchCount += 1;
        return new FakeBrowser();
      },
    });

    await renderer.render(RENDER_INPUT);
    await renderer.close();
    await renderer.close();
    await renderer.render(RENDER_INPUT);

    expect(launchCount).toBe(2);
  });
});

describe("ChromiumPdfRenderer PDF output", () => {
  it("returns the page bytes unchanged", async () => {
    const renderer = new ChromiumPdfRenderer({
      launchBrowser: async () => new FakeBrowser(),
    });

    const bytes = await renderer.render(RENDER_INPUT);

    expect(bytes).toEqual(FAKE_PDF_BYTES);
  });
});
