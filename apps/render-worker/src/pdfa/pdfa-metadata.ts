import type { PdfArchiveOptions } from "@printer/domain";
import type { PDFDocument } from "pdf-lib";
import { PDFName } from "pdf-lib";

import type { PdfaLevelProfile } from "./pdfa-levels.js";
import { decodeLanguage } from "./pdfa-safety.js";

export const PDFA_PRODUCER = "serverless-printer";
export const PDFA_CREATOR = "serverless-printer";

export type PdfaDocumentMetadata = {
  readonly title: string | undefined;
  readonly language: string | undefined;
  readonly createdAt: Date;
};

/**
 * Prefers explicit options, then the metadata Chromium wrote from the
 * document (`<title>` and `<html lang>` become Info Title and catalog Lang).
 */
export function resolvePdfaMetadata(
  pdfDoc: PDFDocument,
  options: PdfArchiveOptions,
): PdfaDocumentMetadata {
  return {
    title: nonEmpty(options.title) ?? nonEmpty(pdfDoc.getTitle()),
    language: nonEmpty(options.language) ?? nonEmpty(decodeLanguage(pdfDoc)),
    createdAt: options.createdAt ?? pdfDoc.getCreationDate() ?? new Date(),
  };
}

export function applyInfoMetadata(pdfDoc: PDFDocument, metadata: PdfaDocumentMetadata): void {
  pdfDoc.setProducer(PDFA_PRODUCER);
  pdfDoc.setCreator(PDFA_CREATOR);
  pdfDoc.setCreationDate(metadata.createdAt);
  pdfDoc.setModificationDate(metadata.createdAt);

  if (metadata.title !== undefined) {
    pdfDoc.setTitle(metadata.title);
  }

  if (metadata.language !== undefined) {
    pdfDoc.setLanguage(metadata.language);
  }
}

export function buildXmpMetadata(
  profile: PdfaLevelProfile,
  metadata: PdfaDocumentMetadata,
): string {
  const createdAt = metadata.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const title =
    metadata.title === undefined
      ? ""
      : `
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${escapeXml(metadata.title)}</rdf:li>
    </rdf:Alt>
   </dc:title>`;
  const language =
    metadata.language === undefined
      ? ""
      : `
   <dc:language>
    <rdf:Bag>
     <rdf:li>${escapeXml(metadata.language)}</rdf:li>
    </rdf:Bag>
   </dc:language>`;

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>${profile.part}</pdfaid:part>
   <pdfaid:conformance>${profile.conformance}</pdfaid:conformance>
   <pdf:PDFVersion>${String(profile.pdfVersion.major)}.${String(profile.pdfVersion.minor)}</pdf:PDFVersion>
   <pdf:Producer>${escapeXml(PDFA_PRODUCER)}</pdf:Producer>
   <xmp:CreatorTool>${escapeXml(PDFA_CREATOR)}</xmp:CreatorTool>
   <xmp:CreateDate>${createdAt}</xmp:CreateDate>
   <xmp:ModifyDate>${createdAt}</xmp:ModifyDate>${title}${language}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function embedXmpMetadata(pdfDoc: PDFDocument, xmp: string): void {
  // pdf-lib converts a string stream one byte per code unit, which corrupts
  // non-ASCII titles; the XMP packet must be UTF-8 encoded before it is stored.
  const stream = pdfDoc.context.stream(new TextEncoder().encode(xmp), {
    Type: "Metadata",
    Subtype: "XML",
  });
  pdfDoc.catalog.set(PDFName.of("Metadata"), pdfDoc.context.register(stream));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
