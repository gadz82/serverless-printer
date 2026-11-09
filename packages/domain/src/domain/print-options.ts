export type PdfaLevel =
  | "PDF/A-1b"
  | "PDF/A-1a"
  | "PDF/A-2b"
  | "PDF/A-2u"
  | "PDF/A-2a"
  | "PDF/A-3b"
  | "PDF/A-3u"
  | "PDF/A-3a";

export type PrintOptions = {
  readonly pdfA?: PdfaLevel | false;
};
