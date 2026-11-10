import type { PDFOptions } from "puppeteer-core";

import type {
  RenderingBrowser,
  RenderingPage,
  RenderingRequest,
} from "../src/rendering/render-page.js";

export const FAKE_PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfake\n%%EOF\n");

export class FakeRequest implements RenderingRequest {
  continued = false;
  abortedWith: string | undefined;

  constructor(
    private readonly requestUrl: string,
    private readonly requestResourceType = "other",
    private readonly continueError?: Error,
  ) {}

  url(): string {
    return this.requestUrl;
  }

  resourceType(): string {
    return this.requestResourceType;
  }

  async continue(): Promise<void> {
    this.continued = true;
    if (this.continueError !== undefined) {
      throw this.continueError;
    }
  }

  async abort(errorCode?: string): Promise<void> {
    this.abortedWith = errorCode ?? "";
  }
}

export type FakePageBehavior = {
  readonly pdf?: (options: PDFOptions) => Promise<Uint8Array>;
  readonly close?: () => Promise<void>;
};

export class FakePage implements RenderingPage {
  javascriptEnabled: boolean | undefined;
  requestInterception = false;
  closed = false;
  closeCount = 0;
  readonly pdfOptions: PDFOptions[] = [];
  readonly navigationUrls: string[] = [];
  private requestListener: ((request: RenderingRequest) => void) | undefined;
  private errorListener: ((error: Error) => void) | undefined;

  constructor(private readonly behavior: FakePageBehavior = {}) {}

  async setJavaScriptEnabled(enabled: boolean): Promise<void> {
    this.javascriptEnabled = enabled;
  }

  async setRequestInterception(enabled: boolean): Promise<void> {
    this.requestInterception = enabled;
  }

  on(event: "request", listener: (request: RenderingRequest) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "request" | "error",
    listener: ((request: RenderingRequest) => void) | ((error: Error) => void),
  ): unknown {
    if (event === "request") {
      this.requestListener = listener as (request: RenderingRequest) => void;
    } else {
      this.errorListener = listener as (error: Error) => void;
    }
    return this;
  }

  setDefaultTimeout(): void {}

  setDefaultNavigationTimeout(): void {}

  async goto(url: string): Promise<unknown> {
    this.navigationUrls.push(url);
    return null;
  }

  async setContent(): Promise<void> {}

  async pdf(options: PDFOptions): Promise<Uint8Array> {
    this.pdfOptions.push(options);
    if (this.behavior.pdf !== undefined) {
      return this.behavior.pdf(options);
    }
    return FAKE_PDF_BYTES.slice();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
    if (this.behavior.close !== undefined) {
      await this.behavior.close();
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  emitRequest(request: RenderingRequest): void {
    this.requestListener?.(request);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

export type FakeBrowserBehavior = {
  readonly close?: () => Promise<void>;
};

export class FakeBrowser implements RenderingBrowser {
  connected = true;
  closeCount = 0;
  readonly pages: FakePage[] = [];

  constructor(
    private readonly createPage: (index: number) => FakePage = () => new FakePage(),
    private readonly behavior: FakeBrowserBehavior = {},
  ) {}

  async newPage(): Promise<RenderingPage> {
    const page = this.createPage(this.pages.length);
    this.pages.push(page);
    return page;
  }

  async close(): Promise<void> {
    this.connected = false;
    this.closeCount += 1;
    if (this.behavior.close !== undefined) {
      await this.behavior.close();
    }
  }
}
