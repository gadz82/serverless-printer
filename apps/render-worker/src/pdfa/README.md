# PDF/A archiver

`PdfLibPdfArchiver` implements the domain `PdfArchiver` port with pdf-lib. It sets the PDF
version, trailer document ID, sRGB ICC output intent, XMP `pdfaid` metadata and Info dictionary,
then rejects encrypted PDFs, JavaScript and unembedded fonts before saving.

Conformance is best effort. Neither the tests nor production run a PDF/A validator; the part-1 and
`a` levels are the most sensitive to Chromium's output.

## Bundled sRGB profile

`sRGB2014.icc` is the ICC v2 sRGB profile published by the International Color Consortium:

- Source: <https://registry.color.org/rgb-registry/profiles/sRGB2014.icc>
- Retrieved: 2026-11-10
- SHA-256: `384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a`
- License: the ICC profile library terms permit copying, distribution and embedding without
  restriction; altered versions must not be presented as the original profile.

The profile is inlined in `srgb2014-icc.ts` so it is present in the bundled Lambda handler. The
`.icc` file is the byte-for-byte source artifact, and a test asserts that the two are identical.
It is embedded as the output intent destination profile; it is never fetched at runtime.
