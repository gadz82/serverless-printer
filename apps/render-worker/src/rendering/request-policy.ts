import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BlockedRequest = {
  readonly url: string;
  readonly resourceType: string;
};

export type RequestPolicy = {
  /**
   * Directories whose bundled files may be loaded. Roots and candidates are
   * resolved through realpath so a symlink cannot escape the template folder.
   */
  readonly fileRoots: readonly string[];
};

/**
 * The renderer may load bundled template files, embedded data and the blank
 * document only. Every network scheme is rejected.
 */
export function isAllowedRequestUrl(url: string, policy: RequestPolicy): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  switch (parsed.protocol) {
    case "data:":
      return true;
    case "about:":
      return parsed.href === "about:blank";
    case "file:":
      return isBundledFileUrl(parsed, policy.fileRoots);
    default:
      return false;
  }
}

function isBundledFileUrl(url: URL, fileRoots: readonly string[]): boolean {
  let candidate: string;
  try {
    candidate = realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }

  return fileRoots.some((root) => {
    try {
      return isPathInside(candidate, realpathSync(root));
    } catch {
      return false;
    }
  });
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}
