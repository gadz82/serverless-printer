import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPdfOptions } from "../src/rendering/page-settings.js";
import { preparePageForRendering } from "../src/rendering/render-page.js";
import { isAllowedRequestUrl, type BlockedRequest } from "../src/rendering/request-policy.js";
import { FakePage, FakeRequest } from "./renderer-fakes.js";

let templateDirectory = "";

beforeAll(async () => {
  templateDirectory = await mkdtemp(path.join(tmpdir(), "printer-renderer-policy-"));
  await writeFile(path.join(templateDirectory, "styles.css"), "body { color: black; }\n", "utf8");
});

afterAll(async () => {
  await rm(templateDirectory, { recursive: true, force: true });
});

describe("shared page settings", () => {
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
  it.each(["data:text/css,body%7Bcolor%3Ablack%7D", "data:image/png;base64,AAAA", "about:blank"])(
    "allows %s",
    (url) => {
      expect(isAllowedRequestUrl(url, { fileRoots: [templateDirectory] })).toBe(true);
    },
  );

  it("allows bundled files below the template directory", () => {
    const url = pathToFileURL(path.join(templateDirectory, "styles.css")).href;
    const directoryUrl = pathToFileURL(`${templateDirectory}${path.sep}`).href;

    expect(isAllowedRequestUrl(url, { fileRoots: [templateDirectory] })).toBe(true);
    expect(isAllowedRequestUrl(directoryUrl, { fileRoots: [templateDirectory] })).toBe(true);
  });

  it.each([
    "https://example.com/styles.css",
    "http://example.com/image.png",
    "ws://example.com/socket",
    "wss://example.com/socket",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "blob:https://example.com/123",
    "about:srcdoc",
    "not a URL",
  ])("blocks %s", (url) => {
    expect(isAllowedRequestUrl(url, { fileRoots: [templateDirectory] })).toBe(false);
  });

  it("blocks file URLs outside the template directory", () => {
    const outside = pathToFileURL(path.join(tmpdir(), "outside.css")).href;
    const lookalike = pathToFileURL(`${templateDirectory}-other${path.sep}styles.css`).href;
    const absoluteOutside = pathToFileURL(
      path.join(path.parse(templateDirectory).root, "etc", "passwd"),
    ).href;

    expect(isAllowedRequestUrl(outside, { fileRoots: [templateDirectory] })).toBe(false);
    expect(isAllowedRequestUrl(lookalike, { fileRoots: [templateDirectory] })).toBe(false);
    expect(isAllowedRequestUrl(absoluteOutside, { fileRoots: [templateDirectory] })).toBe(false);
  });

  it("rejects symlinks that escape the template directory", async () => {
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "printer-renderer-outside-"));
    try {
      const outsideFile = path.join(outsideDirectory, "secret.css");
      await writeFile(outsideFile, "body { color: red; }\n", "utf8");
      const escapingLink = path.join(templateDirectory, "linked-outside.css");
      await symlink(outsideFile, escapingLink);

      expect(
        isAllowedRequestUrl(pathToFileURL(escapingLink).href, { fileRoots: [templateDirectory] }),
      ).toBe(false);

      const escapingDirectory = path.join(templateDirectory, "linked-directory");
      await symlink(outsideDirectory, escapingDirectory, "dir");
      expect(
        isAllowedRequestUrl(pathToFileURL(path.join(escapingDirectory, "secret.css")).href, {
          fileRoots: [templateDirectory],
        }),
      ).toBe(false);

      const insideFile = path.join(templateDirectory, "inside.css");
      await writeFile(insideFile, "body { color: black; }\n", "utf8");
      const insideLink = path.join(templateDirectory, "linked-inside.css");
      await symlink(insideFile, insideLink);

      expect(
        isAllowedRequestUrl(pathToFileURL(insideLink).href, { fileRoots: [templateDirectory] }),
      ).toBe(true);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});

describe("page preparation", () => {
  it("disables JavaScript and installs request interception before loading", async () => {
    const page = new FakePage();

    await preparePageForRendering(page, { fileRoots: [templateDirectory] });

    expect(page.javascriptEnabled).toBe(false);
    expect(page.requestInterception).toBe(true);
  });

  it("continues bundled files and blocks external requests", async () => {
    const page = new FakePage();
    const blocked: BlockedRequest[] = [];
    await preparePageForRendering(page, {
      fileRoots: [templateDirectory],
      onRequestBlocked: (request) => blocked.push(request),
    });

    const bundled = new FakeRequest(
      pathToFileURL(path.join(templateDirectory, "styles.css")).href,
      "stylesheet",
    );
    const external = new FakeRequest("https://example.invalid/image.png", "image");
    const outside = new FakeRequest(pathToFileURL(path.join(tmpdir(), "secret.txt")).href, "other");
    page.emitRequest(bundled);
    page.emitRequest(external);
    page.emitRequest(outside);

    expect(bundled.continued).toBe(true);
    expect(bundled.abortedWith).toBeUndefined();
    expect(external.continued).toBe(false);
    expect(external.abortedWith).toBe("blockedbyclient");
    expect(outside.abortedWith).toBe("blockedbyclient");
    expect(blocked).toEqual([
      { url: "https://example.invalid/image.png", resourceType: "image" },
      { url: pathToFileURL(path.join(tmpdir(), "secret.txt")).href, resourceType: "other" },
    ]);
  });

  it("surfaces interception failures instead of hiding them", async () => {
    const page = new FakePage();
    const continueError = new Error("request already handled");
    const errors: unknown[] = [];
    await preparePageForRendering(page, {
      fileRoots: [templateDirectory],
      onRequestError: (error) => errors.push(error),
    });

    page.emitRequest(new FakeRequest("data:text/plain,ok", "other", continueError));
    await Promise.resolve();

    expect(errors).toEqual([continueError]);
  });
});
