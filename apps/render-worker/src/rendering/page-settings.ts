import type { PDFOptions } from "puppeteer-core";

/**
 * Headers and footers are rendered in Chrome's margin boxes. They must carry
 * their own inline styles because the template's print stylesheet does not
 * apply to them.
 */
export const DEFAULT_HEADER_TEMPLATE =
  '<div style="box-sizing: border-box; color: #52606d; display: flex; font-size: 8px; justify-content: space-between; padding: 0 16mm; width: 100%;">' +
  '<span class="title"></span>' +
  '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
  "</div>";

export const DEFAULT_FOOTER_TEMPLATE =
  '<div style="box-sizing: border-box; color: #52606d; display: flex; font-size: 8px; justify-content: space-between; padding: 0 16mm; width: 100%;">' +
  "<span>Printer</span>" +
  '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
  "</div>";

export const PAGE_MARGIN = {
  top: "20mm",
  right: "16mm",
  bottom: "18mm",
  left: "16mm",
} as const;

export type PdfOptionsOverrides = {
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
};

/**
 * Returns the PDF settings shared by local preview and the Lambda renderer.
 */
export function createPdfOptions(overrides: PdfOptionsOverrides = {}): PDFOptions {
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: overrides.headerTemplate ?? DEFAULT_HEADER_TEMPLATE,
    footerTemplate: overrides.footerTemplate ?? DEFAULT_FOOTER_TEMPLATE,
    margin: { ...PAGE_MARGIN },
  };
}
