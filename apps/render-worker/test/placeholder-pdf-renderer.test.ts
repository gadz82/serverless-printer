import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_PDF_BYTES,
  PlaceholderPdfRenderer,
} from "../src/adapters/placeholder-pdf-renderer.js";

const decoder = new TextDecoder("ascii");

function pdfText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

describe("PlaceholderPdfRenderer", () => {
  it("returns a deterministic, one-page PDF with a valid xref table", () => {
    const text = pdfText(PLACEHOLDER_PDF_BYTES);

    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Type /Page ");
    expect(text).toContain("/Count 1");
    expect(text.endsWith("%%EOF\n")).toBe(true);

    const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
    expect(startxref).not.toBeNull();
    const xrefOffset = Number(startxref?.[1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe("xref");

    const xrefLines = text.slice(xrefOffset).split("\n");
    expect(xrefLines[1]).toBe("0 6");
    expect(xrefLines[2]).toBe("0000000000 65535 f ");

    for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
      const line = xrefLines[2 + objectNumber];
      expect(line).toBeDefined();
      const objectOffset = Number(line?.slice(0, 10));
      expect(text.slice(objectOffset, objectOffset + `${objectNumber} 0 obj`.length)).toBe(
        `${objectNumber} 0 obj`,
      );
    }
  });

  it("returns the same fixed bytes on every invocation", async () => {
    const renderer = new PlaceholderPdfRenderer();

    const first = await renderer.render();
    const second = await renderer.render();

    expect(first).toEqual(PLACEHOLDER_PDF_BYTES);
    expect(second).toEqual(first);
    expect(pdfText(first)).toContain("Printer Phase 1 placeholder");
  });

  it("returns a fresh copy so a caller cannot mutate the shared placeholder", async () => {
    const renderer = new PlaceholderPdfRenderer();
    const first = await renderer.render();

    first[0] = 0;

    expect((await renderer.render())[0]).toBe(0x25);
  });
});
