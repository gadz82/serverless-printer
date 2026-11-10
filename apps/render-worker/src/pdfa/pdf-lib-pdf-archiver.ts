import { createHash } from "node:crypto";

import { PdfaConversionFailed } from "@printer/domain";
import type { PdfArchiveOptions, PdfArchiver } from "@printer/domain";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";

import { PDFA_LEVEL_PROFILES } from "./pdfa-levels.js";
import {
  applyInfoMetadata,
  buildXmpMetadata,
  embedXmpMetadata,
  resolvePdfaMetadata,
} from "./pdfa-metadata.js";
import { assertPdfaSafe } from "./pdfa-safety.js";
import { SRGB2014_ICC } from "./srgb2014-icc.js";

/**
 * Applies the PDF/A metadata layer with pdf-lib.
 *
 * This is deliberately not a validator: it sets the version, document ID,
 * sRGB output intent, XMP identification and Info metadata, and rejects the
 * features that make a document unsafe to label archival. Every other
 * conformance aspect remains best effort.
 */
// ORCHID-MEM: 01a1c6e2-73a4-7f26-9d3e-6b36fad2f5d1 — Applies PDF/A metadata, XMP, ICC and safety checks for all eight levels.
export class PdfLibPdfArchiver implements PdfArchiver {
  async archive(pdfBytes: Uint8Array, options: PdfArchiveOptions): Promise<Uint8Array> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
        throwOnInvalidObject: true,
      });

      assertPdfaSafe(pdfDoc);

      const profile = PDFA_LEVEL_PROFILES[options.level];
      const metadata = resolvePdfaMetadata(pdfDoc, options);

      applyInfoMetadata(pdfDoc, metadata);
      setDocumentId(pdfDoc, pdfBytes);
      embedXmpMetadata(pdfDoc, buildXmpMetadata(profile, metadata));
      embedOutputIntent(pdfDoc);

      const saved = await pdfDoc.save({ useObjectStreams: false });
      return applyHeaderVersion(saved, profile.pdfVersion.major, profile.pdfVersion.minor);
    } catch (error) {
      if (error instanceof PdfaConversionFailed) {
        throw error;
      }

      throw new PdfaConversionFailed(`PDF/A conversion failed: ${messageFrom(error)}`, {
        cause: error,
      });
    }
  }
}

/**
 * pdf-lib's writer always emits a PDF 1.7 header. Part 1 needs 1.4; the
 * writer is already using a classic xref table because object streams are
 * disabled, so replacing the fixed-width header is the only change required.
 */
function applyHeaderVersion(pdfBytes: Uint8Array, major: number, minor: number): Uint8Array {
  const header = new TextEncoder().encode(`%PDF-${String(major)}.${String(minor)}`);
  const versioned = pdfBytes.slice();
  versioned.set(header, 0);
  return versioned;
}

function setDocumentId(pdfDoc: PDFDocument, pdfBytes: Uint8Array): void {
  const digest = createHash("sha256").update(pdfBytes).digest("hex").slice(0, 32);
  const id = PDFHexString.of(digest);
  pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([id, id]);
}

function embedOutputIntent(pdfDoc: PDFDocument): void {
  const context = pdfDoc.context;
  const profileStream = context.stream(SRGB2014_ICC, {
    N: 3,
    Alternate: "DeviceRGB",
  });
  const profileRef = context.register(profileStream);
  const outputIntent = context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputCondition: PDFString.of("sRGB IEC61966-2.1"),
    OutputConditionIdentifier: PDFString.of("sRGB2014"),
    RegistryName: PDFString.of("http://www.color.org"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: profileRef,
  });

  pdfDoc.catalog.set(PDFName.of("OutputIntents"), context.obj([outputIntent]));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
