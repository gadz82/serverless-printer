import { PdfaConversionFailed } from "@printer/domain";
import type { PDFDocument, PDFObject } from "pdf-lib";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";

const FONT_SUBTYPES = new Set([
  "/Type0",
  "/Type1",
  "/MMType1",
  "/TrueType",
  "/Type3",
  "/CIDFontType0",
  "/CIDFontType2",
]);

const FONT_FILE_KEYS = ["FontFile", "FontFile2", "FontFile3"] as const;
const MAX_TRAVERSAL_DEPTH = 100;

/**
 * Rejects the document features that cannot be made PDF/A-compatible by
 * metadata post-processing. The traversal starts at the catalog, so it sees
 * pages, resources, forms, actions, annotations and the AcroForm.
 */
export function assertPdfaSafe(pdfDoc: PDFDocument): void {
  if (pdfDoc.isEncrypted) {
    throw new PdfaConversionFailed("PDF/A conversion failed: encrypted PDF");
  }

  let fontProblem: string | undefined;
  let usesJavaScript = false;

  walkPdfObjects(pdfDoc, (dictionary) => {
    if (fontProblem === undefined && isFontDictionary(dictionary)) {
      if (!isEmbeddedFont(pdfDoc, dictionary)) {
        fontProblem = `PDF/A conversion failed: font is not embedded: ${fontName(dictionary)}`;
      }
    }

    if (hasJavaScript(dictionary)) {
      usesJavaScript = true;
    }
  });

  if (usesJavaScript) {
    throw new PdfaConversionFailed("PDF/A conversion failed: JavaScript is not allowed");
  }

  if (fontProblem !== undefined) {
    throw new PdfaConversionFailed(fontProblem);
  }
}

function walkPdfObjects(pdfDoc: PDFDocument, visit: (dictionary: PDFDict) => void): void {
  const seen = new Set<PDFObject>();

  const walk = (value: PDFObject | undefined, depth: number): void => {
    if (value === undefined || depth > MAX_TRAVERSAL_DEPTH || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (value instanceof PDFRef) {
      walk(pdfDoc.context.lookup(value), depth + 1);
      return;
    }

    if (value instanceof PDFStream) {
      walk(value.dict, depth + 1);
      return;
    }

    if (value instanceof PDFDict) {
      visit(value);
      for (const [, child] of value.entries()) {
        walk(child, depth + 1);
      }
      return;
    }

    if (value instanceof PDFArray) {
      for (const child of value.asArray()) {
        walk(child, depth + 1);
      }
    }
  };

  walk(pdfDoc.catalog, 0);
}

function hasJavaScript(dictionary: PDFDict): boolean {
  if (dictionary.get(PDFName.of("JS")) !== undefined) {
    return true;
  }

  // The /Names /JavaScript name tree and any action or additional-actions
  // dictionary both carry one of these entries.
  const actionType = dictionary.lookupMaybe(PDFName.of("S"), PDFName);
  if (actionType?.asString() === "/JavaScript") {
    return true;
  }

  return dictionary.get(PDFName.of("JavaScript")) !== undefined;
}

function isFontDictionary(dictionary: PDFDict): boolean {
  const type = dictionary.get(PDFName.of("Type"));
  if (type instanceof PDFName && type.asString() === "/Font") {
    return true;
  }

  const subtype = dictionary.get(PDFName.of("Subtype"));
  return subtype instanceof PDFName && FONT_SUBTYPES.has(subtype.asString());
}

function isEmbeddedFont(pdfDoc: PDFDocument, fontDictionary: PDFDict): boolean {
  const subtype = fontDictionary.get(PDFName.of("Subtype"));

  if (subtype instanceof PDFName && subtype.asString() === "/Type3") {
    // Type 3 glyphs live in CharProcs streams inside the font dictionary, so
    // the font is embedded by definition.
    return true;
  }

  if (subtype instanceof PDFName && subtype.asString() === "/Type0") {
    const descendants = fontDictionary.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
    if (descendants !== undefined && descendants.size() > 0) {
      return descendants.asArray().every((value) => {
        const descendant = pdfDoc.context.lookup(value);
        return descendant instanceof PDFDict && hasEmbeddedFontFile(descendant);
      });
    }
  }

  return hasEmbeddedFontFile(fontDictionary);
}

function hasEmbeddedFontFile(fontDictionary: PDFDict): boolean {
  const descriptor = fontDictionary.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  if (descriptor === undefined) {
    return false;
  }

  return FONT_FILE_KEYS.some((key) => {
    const value = descriptor.get(PDFName.of(key));
    return value !== undefined && value !== PDFNull;
  });
}

function fontName(fontDictionary: PDFDict): string {
  const baseFont = fontDictionary.get(PDFName.of("BaseFont"));
  if (baseFont instanceof PDFName) {
    return baseFont.asString().replace(/^\//, "");
  }

  return "(unnamed font)";
}

export function decodeLanguage(pdfDoc: PDFDocument): string | undefined {
  const value = pdfDoc.catalog.get(PDFName.of("Lang"));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }

  return undefined;
}
