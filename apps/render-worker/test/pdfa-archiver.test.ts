import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PdfaConversionFailed } from "@printer/domain";
import type { PdfaLevel } from "@printer/domain";
import type { PDFRef } from "pdf-lib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { PdfLibPdfArchiver } from "../src/pdfa/pdf-lib-pdf-archiver.js";
import { SRGB2014_ICC } from "../src/pdfa/srgb2014-icc.js";

const CREATED_AT = new Date("2026-11-10T09:30:00.000Z");
const ARCHIVER = new PdfLibPdfArchiver();

type LevelCase = {
  readonly level: PdfaLevel;
  readonly pdfVersion: string;
  readonly part: string;
  readonly conformance: string;
};

const LEVEL_CASES: readonly LevelCase[] = [
  { level: "PDF/A-1b", pdfVersion: "1.4", part: "1", conformance: "B" },
  { level: "PDF/A-1a", pdfVersion: "1.4", part: "1", conformance: "A" },
  { level: "PDF/A-2b", pdfVersion: "1.7", part: "2", conformance: "B" },
  { level: "PDF/A-2u", pdfVersion: "1.7", part: "2", conformance: "U" },
  { level: "PDF/A-2a", pdfVersion: "1.7", part: "2", conformance: "A" },
  { level: "PDF/A-3b", pdfVersion: "1.7", part: "3", conformance: "B" },
  { level: "PDF/A-3u", pdfVersion: "1.7", part: "3", conformance: "U" },
  { level: "PDF/A-3a", pdfVersion: "1.7", part: "3", conformance: "A" },
];

type SourceOptions = {
  readonly title?: string;
  readonly language?: string;
  readonly creator?: string;
  readonly createdAt?: Date;
};

async function sourcePdf(options: SourceOptions = {}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595, 842]);

  if (options.title !== undefined) {
    pdfDoc.setTitle(options.title);
  }
  if (options.language !== undefined) {
    pdfDoc.setLanguage(options.language);
  }
  if (options.creator !== undefined) {
    pdfDoc.setCreator(options.creator);
  }
  if (options.createdAt !== undefined) {
    pdfDoc.setCreationDate(options.createdAt);
  }

  return pdfDoc.save({ useObjectStreams: false });
}

async function archive(
  level: PdfaLevel,
  options: SourceOptions = {},
): Promise<{
  readonly bytes: Uint8Array;
  readonly source: Uint8Array;
  readonly document: PDFDocument;
}> {
  const source = await sourcePdf({
    title: "Quarterly report",
    language: "en-GB",
    createdAt: CREATED_AT,
  });
  const bytes = await ARCHIVER.archive(source, {
    level,
    title: options.title ?? "Quarterly report",
    language: options.language ?? "en-GB",
    createdAt: options.createdAt ?? CREATED_AT,
  });
  const document = await PDFDocument.load(bytes, { updateMetadata: false });

  return { bytes, source, document };
}

function readXmp(pdfDoc: PDFDocument): string {
  const reference = pdfDoc.catalog.get(PDFName.of("Metadata"));
  const stream = reference === undefined ? undefined : pdfDoc.context.lookup(reference);
  if (!(stream instanceof PDFRawStream)) {
    throw new Error("archived PDF has no metadata stream");
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(stream.contents);
}

function assertParsesAsXml(xml: string): void {
  const xmllint = spawnSync("xmllint", ["--noout", "-"], {
    input: xml,
    encoding: "utf8",
  });

  if (xmllint.error === undefined) {
    expect(xmllint.status, xmllint.stderr).toBe(0);
    return;
  }

  if ((xmllint.error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw xmllint.error;
  }

  assertWellFormedXml(xml);
}

/**
 * Fallback for environments without xmllint: checks tag nesting, self-closing
 * tags and unescaped XML metacharacters in text nodes.
 */
function assertWellFormedXml(xml: string): void {
  const tokenPattern = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[A-Za-z_][^>]*>/g;
  const stack: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(xml)) !== null) {
    assertXmlText(xml.slice(cursor, match.index));
    cursor = tokenPattern.lastIndex;
    const token = match[0];

    if (token.startsWith("<?") || token.startsWith("<!")) {
      continue;
    }

    const name = /^<\/?([A-Za-z_][\w.:-]*)/.exec(token)?.[1];
    if (name === undefined) {
      throw new Error(`invalid XML tag: ${token}`);
    }

    if (token.startsWith("</")) {
      if (stack.pop() !== name) {
        throw new Error(`mismatched closing tag: ${token}`);
      }
    } else if (!token.endsWith("/>")) {
      stack.push(name);
    }
  }

  assertXmlText(xml.slice(cursor));
  if (stack.length > 0) {
    throw new Error(`unclosed XML tags: ${stack.join(", ")}`);
  }
}

function assertXmlText(text: string): void {
  if (/<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) {
    throw new Error(`unescaped XML metacharacter in text: ${text}`);
  }
}

function attachFont(pdfDoc: PDFDocument, fontRef: PDFRef): void {
  const page = pdfDoc.getPages()[0] ?? pdfDoc.addPage([595, 842]);
  page.node.set(
    PDFName.of("Resources"),
    pdfDoc.context.obj({ Font: pdfDoc.context.obj({ F1: fontRef }) }),
  );
}

function addType0Font(pdfDoc: PDFDocument, embedded: boolean): PDFRef {
  const context = pdfDoc.context;
  const descriptor = context.obj({
    Type: "FontDescriptor",
    FontName: "AAAAAA+TestFont",
    Flags: 4,
    FontBBox: [0, 0, 1000, 1000],
    ItalicAngle: 0,
    Ascent: 800,
    Descent: -200,
    CapHeight: 700,
    StemV: 80,
  });
  if (embedded) {
    descriptor.set(
      PDFName.of("FontFile2"),
      context.register(context.stream(new Uint8Array([0, 1, 0, 0]), { Length1: 4 })),
    );
  }

  const descendant = context.obj({
    Type: "Font",
    Subtype: "CIDFontType2",
    BaseFont: "AAAAAA+TestFont",
    CIDSystemInfo: { Registry: "Adobe", Ordering: "Identity", Supplement: 0 },
    FontDescriptor: context.register(descriptor),
  });
  const type0 = context.obj({
    Type: "Font",
    Subtype: "Type0",
    BaseFont: "AAAAAA+TestFont",
    Encoding: "Identity-H",
    DescendantFonts: [context.register(descendant)],
  });

  return context.register(type0);
}

function addType3Font(pdfDoc: PDFDocument): PDFRef {
  const context = pdfDoc.context;
  const type3 = context.obj({
    Type: "Font",
    Subtype: "Type3",
    FontBBox: [0, 0, 1000, 1000],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: context.obj({
      glyph: context.register(context.stream(new Uint8Array([0]))),
    }),
    Encoding: "WinAnsiEncoding",
    FirstChar: 32,
    LastChar: 32,
    Widths: [500],
    Resources: context.obj({}),
  });

  return context.register(type3);
}

function readLanguage(pdfDoc: PDFDocument): string | undefined {
  const value = pdfDoc.catalog.get(PDFName.of("Lang"));
  if (value instanceof PDFString) {
    return value.decodeText();
  }
  if (value instanceof PDFHexString) {
    return value.decodeText();
  }

  return undefined;
}

function readOutputIntent(pdfDoc: PDFDocument): PDFDict {
  const intents = pdfDoc.catalog.lookup(PDFName.of("OutputIntents"), PDFArray);
  expect(intents.size()).toBe(1);

  return intents.lookup(0, PDFDict);
}

async function conversionFailure(bytes: Uint8Array): Promise<PdfaConversionFailed> {
  try {
    await ARCHIVER.archive(bytes, { level: "PDF/A-2b" });
  } catch (error) {
    if (error instanceof PdfaConversionFailed) {
      return error;
    }
    throw error;
  }

  throw new Error("expected PDF/A conversion to fail");
}

describe("PdfLibPdfArchiver", () => {
  it("bundles the sRGB2014 ICC profile that it embeds", async () => {
    const profileOnDisk = await readFile(new URL("../src/pdfa/sRGB2014.icc", import.meta.url));

    expect(Buffer.from(SRGB2014_ICC)).toEqual(profileOnDisk);
    expect(Buffer.from(SRGB2014_ICC.subarray(16, 20)).toString("latin1")).toBe("RGB ");
    expect(Buffer.from(SRGB2014_ICC.subarray(20, 24)).toString("latin1")).toBe("XYZ ");
    expect(Buffer.from(SRGB2014_ICC.subarray(36, 40)).toString("latin1")).toBe("acsp");
  });

  it.each(LEVEL_CASES)(
    "$level sets the version, XMP identification, ICC intent and Info metadata",
    async ({ level, pdfVersion, part, conformance }) => {
      const { bytes, source, document } = await archive(level);

      expect(document.context.header.toString()).toContain(`%PDF-${pdfVersion}`);
      expect(document.getTitle()).toBe("Quarterly report");
      expect(document.getProducer()).toBe("serverless-printer");
      expect(document.getCreator()).toBe("serverless-printer");
      expect(document.getCreationDate()?.toISOString()).toBe(CREATED_AT.toISOString());
      expect(readLanguage(document)).toBe("en-GB");

      const xmp = readXmp(document);
      expect(xmp).toContain(`<pdfaid:part>${part}</pdfaid:part>`);
      expect(xmp).toContain(`<pdfaid:conformance>${conformance}</pdfaid:conformance>`);
      expect(xmp).toContain(`<pdf:PDFVersion>${pdfVersion}</pdf:PDFVersion>`);
      expect(xmp).toContain("<dc:title>");
      expect(xmp).toContain("Quarterly report");
      expect(xmp).toContain("<rdf:li>en-GB</rdf:li>");
      expect(xmp).toContain(`<xmp:CreateDate>${CREATED_AT.toISOString().replace(".000Z", "Z")}`);
      expect(xmp).toContain("<pdf:Producer>serverless-printer</pdf:Producer>");
      expect(xmp).toContain("<xmp:CreatorTool>serverless-printer</xmp:CreatorTool>");

      const outputIntent = readOutputIntent(document);
      expect(outputIntent.lookup(PDFName.of("S"), PDFName).asString()).toBe("/GTS_PDFA1");
      expect(
        outputIntent.lookup(PDFName.of("OutputConditionIdentifier"), PDFString).decodeText(),
      ).toBe("sRGB2014");
      const destinationProfile = outputIntent.lookup(PDFName.of("DestOutputProfile"));
      if (!(destinationProfile instanceof PDFRawStream)) {
        throw new Error("output intent has no inline destination profile stream");
      }
      expect(Buffer.from(destinationProfile.contents)).toEqual(Buffer.from(SRGB2014_ICC));
      expect(destinationProfile.dict.lookup(PDFName.of("N"), PDFNumber).asNumber()).toBe(3);

      const trailerId = document.context.trailerInfo.ID;
      expect(trailerId).toBeInstanceOf(PDFArray);
      const ids = (trailerId as PDFArray).asArray();
      expect(ids).toHaveLength(2);
      const expectedId = createHash("sha256").update(source).digest("hex").slice(0, 32);
      for (const value of ids) {
        expect(value).toBeInstanceOf(PDFHexString);
        expect((value as PDFHexString).asString()).toBe(expectedId);
      }

      // The profile stream and metadata are part of the saved output, not
      // only of the in-memory document used to build it.
      expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    },
  );

  it("uses the source title, language and creation date when options omit them", async () => {
    const source = await sourcePdf({
      title: "Source title",
      language: "fr-FR",
      createdAt: CREATED_AT,
    });

    const archived = await ARCHIVER.archive(source, { level: "PDF/A-2b" });
    const document = await PDFDocument.load(archived, { updateMetadata: false });

    expect(document.getTitle()).toBe("Source title");
    expect(document.getCreationDate()?.toISOString()).toBe(CREATED_AT.toISOString());
    expect(readLanguage(document)).toBe("fr-FR");
    expect(readXmp(document)).toContain("<rdf:li>fr-FR</rdf:li>");
  });

  it("prefers explicit options over the source metadata", async () => {
    const source = await sourcePdf({
      title: "Source title",
      language: "fr-FR",
      createdAt: CREATED_AT,
    });
    const createdAt = new Date("2026-11-10T11:45:00.000Z");

    const archived = await ARCHIVER.archive(source, {
      level: "PDF/A-3u",
      title: "Chosen title",
      language: "de-DE",
      createdAt,
    });
    const document = await PDFDocument.load(archived, { updateMetadata: false });

    expect(document.getTitle()).toBe("Chosen title");
    expect(document.getCreationDate()?.toISOString()).toBe(createdAt.toISOString());
    expect(readLanguage(document)).toBe("de-DE");
    expect(readXmp(document)).toContain("<rdf:li>de-DE</rdf:li>");
  });

  it("writes valid UTF-8 XMP for a non-ASCII title", async () => {
    const title = "Café — naïve ✓";
    const source = await sourcePdf({
      title,
      language: "fr-FR",
      createdAt: CREATED_AT,
    });

    const archived = await ARCHIVER.archive(source, {
      level: "PDF/A-2b",
      title,
      language: "fr-FR",
      createdAt: CREATED_AT,
    });
    const document = await PDFDocument.load(archived, { updateMetadata: false });
    const xmp = readXmp(document);

    expect(document.getTitle()).toBe(title);
    expect(xmp).toContain(`<rdf:li xml:lang="x-default">${title}</rdf:li>`);
    assertParsesAsXml(xmp);
  });

  it("normalizes the source Creator and mirrors it in XMP", async () => {
    const chromeCreator =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "HeadlessChrome/153.0.0.0 Safari/537.36";
    const source = await sourcePdf({
      title: "Quarterly report",
      creator: chromeCreator,
      createdAt: CREATED_AT,
    });

    const sourceDocument = await PDFDocument.load(source, { updateMetadata: false });
    expect(sourceDocument.getCreator()).toBe(chromeCreator);

    const archived = await ARCHIVER.archive(source, {
      level: "PDF/A-2b",
      createdAt: CREATED_AT,
    });
    const document = await PDFDocument.load(archived, { updateMetadata: false });
    const xmp = readXmp(document);

    expect(document.getCreator()).toBe("serverless-printer");
    expect(xmp).toContain("<xmp:CreatorTool>serverless-printer</xmp:CreatorTool>");
    expect(xmp).not.toContain("HeadlessChrome");
  });

  it("accepts an embedded Type0 font", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    attachFont(pdfDoc, addType0Font(pdfDoc, true));

    const archived = await ARCHIVER.archive(await pdfDoc.save(), {
      level: "PDF/A-2b",
      createdAt: CREATED_AT,
    });
    const document = await PDFDocument.load(archived, { updateMetadata: false });

    expect(document.getPageCount()).toBe(1);
  });

  it("rejects a Type0 font whose descendant font is not embedded", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    attachFont(pdfDoc, addType0Font(pdfDoc, false));

    const error = await conversionFailure(await pdfDoc.save());

    expect(error.message).toContain("font is not embedded");
    expect(error.message).toContain("AAAAAA+TestFont");
  });

  it("accepts Type3 fonts as embedded", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    attachFont(pdfDoc, addType3Font(pdfDoc));

    const archived = await ARCHIVER.archive(await pdfDoc.save(), {
      level: "PDF/A-2b",
      createdAt: CREATED_AT,
    });
    const document = await PDFDocument.load(archived, { updateMetadata: false });

    expect(document.getPageCount()).toBe(1);
  });

  it("rejects a PDF with an unembedded standard font", async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText("Hello", { font });

    const error = await conversionFailure(await pdfDoc.save());

    expect(error.message).toContain("font is not embedded");
    expect(error.message).toContain("Helvetica");
  });

  it("rejects a PDF that contains JavaScript", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    pdfDoc.catalog.set(
      PDFName.of("OpenAction"),
      pdfDoc.context.obj({
        Type: "Action",
        S: "JavaScript",
        JS: PDFString.of("app.alert('unsafe')"),
      }),
    );

    const error = await conversionFailure(await pdfDoc.save());

    expect(error.message).toBe("PDF/A conversion failed: JavaScript is not allowed");
  });

  it("rejects an encrypted PDF", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    pdfDoc.context.trailerInfo.Encrypt = pdfDoc.context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      O: PDFString.of("owner"),
      U: PDFString.of("user"),
      P: -4,
    });

    const error = await conversionFailure(await pdfDoc.save());

    expect(error.message).toBe("PDF/A conversion failed: encrypted PDF");
  });

  it("wraps an unparseable PDF in PDFA_CONVERSION_FAILED", async () => {
    const error = await conversionFailure(new TextEncoder().encode("not a PDF"));

    expect(error.code).toBe("PDFA_CONVERSION_FAILED");
    expect(error.message).toContain("PDF/A conversion failed");
  });
});
