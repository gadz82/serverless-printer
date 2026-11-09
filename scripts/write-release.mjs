import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const version = process.argv[2];

if (version === undefined || version.trim().length === 0) {
  console.error("Usage: node scripts/write-release.mjs <version>");
  process.exitCode = 1;
} else {
  const releaseFile = fileURLToPath(new URL("../.release-version", import.meta.url));

  // The release workflow prefixes this with "v"; keep the file byte-exact so
  // command substitution does not pick up a newline.
  await writeFile(releaseFile, version, "utf8");
  console.log(`Wrote ${version} to .release-version.`);
}
