import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PdfRenderFailed, TemplateRenderFailed, type TemplateDescriptor } from "@printer/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  TemplatePdfRenderer,
  type TemplateChromiumRenderer,
} from "../src/rendering/template-pdf-renderer.js";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\ntemplate\n%%EOF\n");
const MANIFEST_FILE = "templates.manifest.json";

let directories: string[] = [];

async function templateRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "printer-template-renderer-"));
  directories.push(directory);
  return directory;
}

function descriptor(bundlePath = "templates/sample"): TemplateDescriptor {
  return {
    id: "72803074-1601-4a08-a5a5-49db9feacd66",
    slug: "sample",
    contentHash: "a".repeat(64),
    release: "local",
    bundlePath,
  };
}

class RecordingChromium implements TemplateChromiumRenderer {
  readonly calls: { html: string; baseDirectory: string }[] = [];

  constructor(private readonly handler: () => Promise<Uint8Array> = async () => PDF_BYTES) {}

  async render(input: {
    readonly html: string;
    readonly baseDirectory: string;
  }): Promise<Uint8Array> {
    this.calls.push({ html: input.html, baseDirectory: input.baseDirectory });
    return this.handler();
  }
}

async function rendererFor(
  root: string,
  options: {
    readonly mode?: "lenient" | "strict" | "assume-objects";
    readonly chromium?: RecordingChromium;
    readonly bundleRoot?: string;
  } = {},
): Promise<{ renderer: TemplatePdfRenderer; chromium: RecordingChromium }> {
  const chromium = options.chromium ?? new RecordingChromium();
  return {
    chromium,
    renderer: new TemplatePdfRenderer({
      manifestPath: path.join(root, MANIFEST_FILE),
      mode: options.mode ?? "lenient",
      ...(options.bundleRoot === undefined ? {} : { bundleRoot: options.bundleRoot }),
      chromium,
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories = [];
});

describe("TemplatePdfRenderer", () => {
  it("reads index.html from the bundle root, compiles the payload and renders in that directory", async () => {
    const root = await templateRoot();
    const directory = path.join(root, "templates", "sample");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "index.html"),
      "<html><body><h1>{{message}}</h1></body></html>",
      "utf8",
    );
    const { renderer, chromium } = await rendererFor(root);

    const bytes = await renderer.render({
      template: descriptor(),
      payload: { message: "<b>Printer</b>" },
      pdfA: null,
    });

    expect(bytes).toBe(PDF_BYTES);
    expect(chromium.calls).toEqual([
      {
        html: "<html><body><h1>&lt;b&gt;Printer&lt;/b&gt;</h1></body></html>",
        baseDirectory: directory,
      },
    ]);
  });

  it("falls back to the first .html or .hbs file when index.html is absent", async () => {
    const root = await templateRoot();
    const directory = path.join(root, "templates", "sample");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "notes.txt"), "ignored", "utf8");
    await writeFile(path.join(directory, "b-report.hbs"), "<p>{{name}}</p>", "utf8");
    const { renderer, chromium } = await rendererFor(root);

    await renderer.render({
      template: descriptor(),
      payload: { name: "Ada" },
      pdfA: null,
    });

    expect(chromium.calls[0]?.html).toBe("<p>Ada</p>");
  });

  it("uses an explicit bundle root when the manifest lives elsewhere", async () => {
    const manifestRoot = await templateRoot();
    const bundleRoot = await templateRoot();
    const directory = path.join(bundleRoot, "templates", "sample");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), "<p>explicit</p>", "utf8");
    const { renderer, chromium } = await rendererFor(manifestRoot, { bundleRoot });

    await renderer.render({ template: descriptor(), payload: {}, pdfA: null });

    expect(chromium.calls[0]?.baseDirectory).toBe(directory);
  });

  it("maps a strict-mode missing field to TEMPLATE_RENDER_FAILED", async () => {
    const root = await templateRoot();
    const directory = path.join(root, "templates", "sample");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), "<p>{{missing}}</p>", "utf8");
    const { renderer, chromium } = await rendererFor(root, { mode: "strict" });

    await expect(
      renderer.render({ template: descriptor(), payload: {}, pdfA: null }),
    ).rejects.toMatchObject({
      name: "TemplateRenderFailed",
      code: "TEMPLATE_RENDER_FAILED",
      retryable: false,
    });
    expect(chromium.calls).toHaveLength(0);
  });

  it("fails when the bundle is missing or has no HTML file", async () => {
    const root = await templateRoot();
    const emptyDirectory = path.join(root, "templates", "empty");
    await mkdir(emptyDirectory, { recursive: true });
    const { renderer } = await rendererFor(root);

    await expect(
      renderer.render({ template: descriptor("templates/missing"), payload: {}, pdfA: null }),
    ).rejects.toBeInstanceOf(TemplateRenderFailed);
    await expect(
      renderer.render({ template: descriptor("templates/empty"), payload: {}, pdfA: null }),
    ).rejects.toBeInstanceOf(TemplateRenderFailed);
  });

  it("rejects a bundle path that escapes the bundle root", async () => {
    const root = await templateRoot();
    const { renderer, chromium } = await rendererFor(root);

    await expect(
      renderer.render({ template: descriptor("../outside"), payload: {}, pdfA: null }),
    ).rejects.toBeInstanceOf(TemplateRenderFailed);
    expect(chromium.calls).toHaveLength(0);
  });

  it("propagates a retryable Chromium failure unchanged", async () => {
    const root = await templateRoot();
    const directory = path.join(root, "templates", "sample");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), "<p>ok</p>", "utf8");
    const failure = new PdfRenderFailed("chromium crashed");
    const chromium = new RecordingChromium(async () => Promise.reject(failure));
    const { renderer } = await rendererFor(root, { chromium });

    await expect(renderer.render({ template: descriptor(), payload: {}, pdfA: null })).rejects.toBe(
      failure,
    );
  });
});
