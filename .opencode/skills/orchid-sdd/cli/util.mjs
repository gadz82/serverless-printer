import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
export const SKILL_VERSION = packageJson.version;
export const SCHEMA_VERSION = "1.0.0";

export class OrchidError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "OrchidError";
    this.exitCode = exitCode;
  }
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function month() {
  return new Date().toISOString().slice(0, 7);
}

/** Time-ordered UUIDv7. */
export function uuid7() {
  const bytes = crypto.randomBytes(16);
  let ms = BigInt(Date.now());
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid7(value) {
  return UUID7_RE.test(value || "");
}

export function isUuid(value) {
  return UUID_RE.test(value || "");
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256Prefixed(text) {
  return "sha256:" + sha256(text);
}

export function sha256File(file) {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function slugify(value, maxLen = 48) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (ascii.slice(0, maxLen).replace(/-+$/g, "") || "iteration");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(file) {
  return fs.existsSync(file);
}

export function readText(file) {
  return fs.readFileSync(file, "utf8");
}

export function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.orchid-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new OrchidError(`cannot read JSON at ${file}: ${error.message}`);
  }
}

export function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write a generated cache without indentation; content is machine-read only. */
export function writeJsonCompact(file, value) {
  atomicWrite(file, `${JSON.stringify(value)}\n`);
}

export function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(value) {
  return "sha256:" + sha256(stableStringify(value));
}

/** Remove volatile fields before comparing projections. */
export function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== "generatedAt") out[key] = stripVolatile(inner);
    }
    return out;
  }
  return value;
}

export function* walkFiles(root, extensions, excludeDirs = []) {
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const excluded = new Set(excludeDirs.map((d) => d.toLowerCase()));

  function* visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name.toLowerCase())) yield* visit(full);
      } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
        yield full;
      }
    }
  }

  yield* visit(root);
}

export function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function splitCommas(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitSemicolons(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Lowercase alphanumeric tokens, shared by the recall index (`terms`) and recall
 * scoring. Length-1 tokens are dropped so code IDs like `R-001` do not leave a
 * stray `r` that spurious-matches unrelated IDs.
 */
export function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

export function truncate(value, length = 160) {
  const text = String(value || "");
  return text.length <= length ? text : text.slice(0, length - 1) + "…";
}

export function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

export function sortObject(value) {
  if (Array.isArray(value)) return sortUnique(value.map(sortObject));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortObject(value[key]);
    return out;
  }
  return value;
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}
