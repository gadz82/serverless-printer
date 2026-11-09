import { fileURLToPath } from "node:url";
import type { PdfaLevel } from "@printer/domain";

export type HandlebarsMode = "lenient" | "strict" | "assume-objects";

export type WorkerConfig = {
  readonly printsBucket: string;
  readonly handlebarsMode: HandlebarsMode;
  readonly pdfaAllowedLevels: readonly PdfaLevel[];
  readonly callbackAllowlist: readonly string[];
  readonly eventSource: string;
  readonly presignTtlSeconds: number;
  readonly maxReceiveCount: number;
  readonly templateManifestPath: string;
  readonly sqsEndpointUrl: string | undefined;
};

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

const HANDLEBARS_MODES: readonly HandlebarsMode[] = ["lenient", "strict", "assume-objects"];

const PDFA_LEVELS: readonly PdfaLevel[] = [
  "PDF/A-1b",
  "PDF/A-1a",
  "PDF/A-2b",
  "PDF/A-2u",
  "PDF/A-2a",
  "PDF/A-3b",
  "PDF/A-3u",
  "PDF/A-3a",
];

const MAX_PRESIGN_TTL_SECONDS = 604_800;
const MAX_RECEIVE_COUNT = 1_000;
const DEFAULT_PRESIGN_TTL_SECONDS = 900;
const DEFAULT_MAX_RECEIVE_COUNT = 5;

/**
 * The release build copies the generated manifest next to the bundled handler,
 * so this resolves to dist/templates.manifest.json in Lambda.
 */
const DEFAULT_TEMPLATE_MANIFEST_PATH = fileURLToPath(
  new URL("./templates.manifest.json", import.meta.url),
);

const LOOPBACK_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Parses the worker environment at cold start.
 *
 * Invalid values fail the invocation before any message is processed. Error
 * messages name the variable and the expected shape, never the value, because
 * the environment can contain callback URLs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    printsBucket: readRequired(env, "PRINTS_BUCKET"),
    handlebarsMode: readHandlebarsMode(env["HANDLEBARS_MODE"]),
    pdfaAllowedLevels: readPdfaLevels(env["PDFA_ALLOWED_LEVELS"]),
    callbackAllowlist: readCallbackAllowlist(env["CALLBACK_ALLOWLIST"]),
    eventSource: readOptional(env["EVENT_SOURCE"]) ?? "printer",
    presignTtlSeconds: readPositiveInteger(
      env["PRESIGN_TTL_SECONDS"],
      DEFAULT_PRESIGN_TTL_SECONDS,
      "PRESIGN_TTL_SECONDS",
      MAX_PRESIGN_TTL_SECONDS,
    ),
    maxReceiveCount: readPositiveInteger(
      env["MAX_RECEIVE_COUNT"],
      DEFAULT_MAX_RECEIVE_COUNT,
      "MAX_RECEIVE_COUNT",
      MAX_RECEIVE_COUNT,
    ),
    templateManifestPath:
      readOptional(env["TEMPLATE_MANIFEST_PATH"]) ?? DEFAULT_TEMPLATE_MANIFEST_PATH,
    sqsEndpointUrl: readSqsEndpointUrl(env["SQS_ENDPOINT_URL"]),
  };
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = readOptional(env[name]);
  if (value === undefined) {
    throw new ConfigError(`${name} is required and must be a non-empty string`);
  }

  return value;
}

function readOptional(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

function readHandlebarsMode(raw: string | undefined): HandlebarsMode {
  const value = readOptional(raw);
  if (value === undefined) {
    return "lenient";
  }

  if (!isHandlebarsMode(value)) {
    throw new ConfigError(`HANDLEBARS_MODE must be one of: ${HANDLEBARS_MODES.join(", ")}`);
  }

  return value;
}

function isHandlebarsMode(value: string): value is HandlebarsMode {
  return (HANDLEBARS_MODES as readonly string[]).includes(value);
}

function readPdfaLevels(raw: string | undefined): readonly PdfaLevel[] {
  const value = readOptional(raw);
  if (value === undefined) {
    return [];
  }

  const levels = value
    .split(",")
    .map((level) => level.trim())
    .filter((level) => level.length > 0);

  const invalid = levels.filter((level) => !isPdfaLevel(level));
  if (invalid.length > 0) {
    throw new ConfigError(
      `PDFA_ALLOWED_LEVELS contains unsupported levels; expected ${PDFA_LEVELS.join(", ")}`,
    );
  }

  return [...new Set(levels.filter(isPdfaLevel))];
}

function isPdfaLevel(value: string): value is PdfaLevel {
  return (PDFA_LEVELS as readonly string[]).includes(value);
}

function readCallbackAllowlist(raw: string | undefined): readonly string[] {
  const value = readOptional(raw);
  if (value === undefined) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new ConfigError("CALLBACK_ALLOWLIST must be a valid JSON array of strings", {
      cause: error,
    });
  }

  if (!Array.isArray(parsed) || !parsed.every(isNonEmptyString)) {
    throw new ConfigError("CALLBACK_ALLOWLIST must be a JSON array of non-empty strings");
  }

  return parsed;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readSqsEndpointUrl(raw: string | undefined): string | undefined {
  const value = readOptional(raw);
  if (value === undefined) {
    return undefined;
  }

  // A local/test endpoint. HTTPS is fine anywhere; plain HTTP must stay on
  // the loopback interface so production callbacks cannot silently use it.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new ConfigError("SQS_ENDPOINT_URL must be a valid http or https URL", { cause: error });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError("SQS_ENDPOINT_URL must use http or https");
  }

  if (parsed.protocol === "http:" && !LOOPBACK_HTTP_HOSTS.has(parsed.hostname)) {
    throw new ConfigError(
      "SQS_ENDPOINT_URL with http is only allowed for loopback hosts (localhost, 127.0.0.1, [::1])",
    );
  }

  return value;
}

function readPositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const value = readOptional(raw);
  if (value === undefined) {
    return fallback;
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new ConfigError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ConfigError(`${name} must be an integer between 1 and ${maximum}`);
  }

  return parsed;
}
