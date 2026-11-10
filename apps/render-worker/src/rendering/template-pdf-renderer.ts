import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { TemplateRenderFailed } from "@printer/domain";
import type { PdfRenderer, RenderPdfInput } from "@printer/domain";
import { compileTemplate, type HandlebarsMode } from "@printer/template-engine";

import { ChromiumPdfRenderer } from "./chromium-pdf-renderer.js";

export type TemplateChromiumRenderer = {
  render(input: { readonly html: string; readonly baseDirectory: string }): Promise<Uint8Array>;
};

export type TemplatePdfRendererOptions = {
  readonly manifestPath: string;
  readonly mode: HandlebarsMode;
  /**
   * Root the manifest's relative bundle paths are resolved against. It
   * defaults to the manifest's directory, which is how the release zip is laid
   * out (manifest and templates/ side by side).
   */
  readonly bundleRoot?: string;
  /** Test seam: production keeps one ChromiumPdfRenderer for the instance. */
  readonly chromium?: TemplateChromiumRenderer;
};

const HTML_FILE_PATTERN = /\.(?:html|hbs)$/i;

/**
 * Resolves a compiled template bundle, renders its HTML with the configured
 * Handlebars mode and hands it to the shared Chromium renderer. The template
 * directory is also the base directory, so relative stylesheets and assets
 * stay inside the allowed file roots.
 */
export class TemplatePdfRenderer implements PdfRenderer {
  private readonly mode: HandlebarsMode;
  private readonly bundleRoot: string;
  /** The selected Chromium/local adapter; one instance is reused per worker. */
  readonly chromium: TemplateChromiumRenderer;

  constructor(options: TemplatePdfRendererOptions) {
    this.mode = options.mode;
    this.bundleRoot = path.resolve(
      options.bundleRoot ?? path.dirname(path.resolve(options.manifestPath)),
    );
    this.chromium = options.chromium ?? new ChromiumPdfRenderer();
  }

  async render(input: RenderPdfInput): Promise<Uint8Array> {
    const directory = this.resolveDirectory(input.template.bundlePath);
    const source = await readTemplateSource(directory);

    let html: string;
    try {
      html = compileTemplate(source, { mode: this.mode })(input.payload);
    } catch (error) {
      throw new TemplateRenderFailed(`template render failed: ${messageFrom(error)}`, {
        cause: error,
      });
    }

    return this.chromium.render({ html, baseDirectory: directory });
  }

  private resolveDirectory(bundlePath: string): string {
    const directory = path.resolve(this.bundleRoot, bundlePath);
    if (!isInside(this.bundleRoot, directory)) {
      throw new TemplateRenderFailed("template bundle path resolves outside the bundle root");
    }

    return directory;
  }
}

async function readTemplateSource(directory: string): Promise<string> {
  const indexPath = path.join(directory, "index.html");
  try {
    return await readFile(indexPath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new TemplateRenderFailed(`cannot read template entry point in ${directory}`, {
        cause: error,
      });
    }
  }

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new TemplateRenderFailed(`cannot read template directory ${directory}`, {
      cause: error,
    });
  }

  const firstHtml = entries
    .filter((entry) => entry.isFile() && HTML_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()[0];

  if (firstHtml === undefined) {
    throw new TemplateRenderFailed(
      `template bundle ${directory} contains no index.html or HTML template`,
    );
  }

  try {
    return await readFile(path.join(directory, firstHtml), "utf8");
  } catch (error) {
    throw new TemplateRenderFailed(`cannot read template ${firstHtml} in ${directory}`, {
      cause: error,
    });
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
