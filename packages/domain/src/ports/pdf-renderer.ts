import type { PdfaLevel } from "../domain/print-options.js";
import type { TemplateDescriptor } from "../domain/template-descriptor.js";

export type RenderPdfInput = {
  readonly template: TemplateDescriptor;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly pdfA: PdfaLevel | null;
};

export interface PdfRenderer {
  render(input: RenderPdfInput): Promise<Uint8Array>;
}
