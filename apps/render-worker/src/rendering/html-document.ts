import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Inserts a <base> so relative stylesheet and asset URLs resolve inside the
 * template folder while the document itself is supplied through setContent().
 */
export function buildHtmlDocument(html: string, baseDirectory: string): string {
  const baseElement = `<base href="${escapeHtmlAttribute(directoryToFileUrl(baseDirectory))}" />`;
  const headPattern = /<head\b[^>]*>/i;

  if (headPattern.test(html)) {
    return html.replace(headPattern, (head) => `${head}\n    ${baseElement}`);
  }

  const htmlPattern = /<html\b[^>]*>/i;
  if (htmlPattern.test(html)) {
    return html.replace(
      htmlPattern,
      (htmlTag) => `${htmlTag}\n  <head>\n    ${baseElement}\n  </head>`,
    );
  }

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    `    ${baseElement}`,
    "  </head>",
    "  <body>",
    html,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

export function directoryToFileUrl(directory: string): string {
  const absoluteDirectory = path.resolve(directory);
  const withTrailingSeparator = absoluteDirectory.endsWith(path.sep)
    ? absoluteDirectory
    : `${absoluteDirectory}${path.sep}`;

  return pathToFileURL(withTrailingSeparator).href;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
