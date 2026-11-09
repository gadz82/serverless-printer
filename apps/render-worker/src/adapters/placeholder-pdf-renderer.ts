import type { PdfRenderer } from "@printer/domain";

const PAGE_TEXT = "Printer Phase 1 placeholder";
const CONTENT_STREAM = `BT\n/F1 18 Tf\n72 770 Td\n(${PAGE_TEXT}) Tj\nET\n`;

const PDF_OBJECTS: readonly string[] = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${CONTENT_STREAM.length} >>\nstream\n${CONTENT_STREAM}endstream`,
];

function buildPlaceholderPdf(): Uint8Array {
  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  let offset = Buffer.byteLength(parts[0] ?? "", "utf8");

  PDF_OBJECTS.forEach((object, index) => {
    offsets.push(offset);
    const serialized = `${index + 1} 0 obj\n${object}\nendobj\n`;
    parts.push(serialized);
    offset += Buffer.byteLength(serialized, "utf8");
  });

  const xrefOffset = offset;
  const xrefLines = ["xref", `0 ${PDF_OBJECTS.length + 1}`, "0000000000 65535 f "];
  for (const objectOffset of offsets) {
    xrefLines.push(`${String(objectOffset).padStart(10, "0")} 00000 n `);
  }

  parts.push(`${xrefLines.join("\n")}\n`);
  parts.push(
    `trailer\n<< /Size ${PDF_OBJECTS.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new TextEncoder().encode(parts.join(""));
}

export const PLACEHOLDER_PDF_BYTES = buildPlaceholderPdf();

/**
 * Phase 1 placeholder behind the PdfRenderer port.
 *
 * It deliberately ignores the template, payload and PDF/A level and returns a
 * fixed one-page PDF. It proves storage and delivery, not rendering fidelity;
 * Chromium and PDF/A replace this adapter in Phase 3.
 */
export class PlaceholderPdfRenderer implements PdfRenderer {
  async render(): Promise<Uint8Array> {
    return PLACEHOLDER_PDF_BYTES.slice();
  }
}
