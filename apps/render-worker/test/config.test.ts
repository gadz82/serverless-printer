import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const BUNDLED_MANIFEST = fileURLToPath(new URL("../src/templates.manifest.json", import.meta.url));

describe("loadConfig", () => {
  it("applies the documented defaults with only the bucket set", () => {
    const config = loadConfig({ PRINTS_BUCKET: "printer-prints" });

    expect(config).toEqual({
      printsBucket: "printer-prints",
      handlebarsMode: "lenient",
      pdfaAllowedLevels: [],
      callbackAllowlist: [],
      eventSource: "printer",
      presignTtlSeconds: 900,
      maxReceiveCount: 5,
      templateManifestPath: BUNDLED_MANIFEST,
      sqsEndpointUrl: undefined,
    });
  });

  it("parses every configured value", () => {
    const config = loadConfig({
      PRINTS_BUCKET: " printer-prints ",
      HANDLEBARS_MODE: "strict",
      PDFA_ALLOWED_LEVELS: "PDF/A-1b, PDF/A-2b,PDF/A-2b",
      CALLBACK_ALLOWLIST: '["https://callbacks.example.com","https://*.example.net"]',
      EVENT_SOURCE: "printer-test",
      PRESIGN_TTL_SECONDS: "120",
      MAX_RECEIVE_COUNT: "3",
      TEMPLATE_MANIFEST_PATH: " /tmp/templates.manifest.json ",
      SQS_ENDPOINT_URL: " http://localhost:4566/ ",
    });

    expect(config).toEqual({
      printsBucket: "printer-prints",
      handlebarsMode: "strict",
      pdfaAllowedLevels: ["PDF/A-1b", "PDF/A-2b"],
      callbackAllowlist: ["https://callbacks.example.com", "https://*.example.net"],
      eventSource: "printer-test",
      presignTtlSeconds: 120,
      maxReceiveCount: 3,
      templateManifestPath: "/tmp/templates.manifest.json",
      sqsEndpointUrl: "http://localhost:4566/",
    });
  });

  it("treats empty optional values as absent", () => {
    const config = loadConfig({
      PRINTS_BUCKET: "printer-prints",
      HANDLEBARS_MODE: " ",
      PDFA_ALLOWED_LEVELS: "",
      CALLBACK_ALLOWLIST: " ",
      EVENT_SOURCE: "",
      TEMPLATE_MANIFEST_PATH: "",
      SQS_ENDPOINT_URL: " ",
    });

    expect(config.handlebarsMode).toBe("lenient");
    expect(config.pdfaAllowedLevels).toEqual([]);
    expect(config.callbackAllowlist).toEqual([]);
    expect(config.eventSource).toBe("printer");
    expect(config.templateManifestPath).toBe(BUNDLED_MANIFEST);
    expect(config.sqsEndpointUrl).toBeUndefined();
  });

  it("fails when PRINTS_BUCKET is missing or empty", () => {
    expect(() => loadConfig({})).toThrow(/PRINTS_BUCKET is required/);
    expect(() => loadConfig({ PRINTS_BUCKET: "  " })).toThrow(/PRINTS_BUCKET is required/);
  });

  it("fails on an unknown HANDLEBARS_MODE", () => {
    expect(() => loadConfig({ PRINTS_BUCKET: "printer-prints", HANDLEBARS_MODE: "loose" })).toThrow(
      ConfigError,
    );
  });

  it("fails on an unsupported PDF/A level", () => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", PDFA_ALLOWED_LEVELS: "PDF/A-4b" }),
    ).toThrow(/PDFA_ALLOWED_LEVELS/);
  });

  it("fails when CALLBACK_ALLOWLIST is not valid JSON", () => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", CALLBACK_ALLOWLIST: "not-json" }),
    ).toThrow(/CALLBACK_ALLOWLIST must be a valid JSON array/);
  });

  it("fails when CALLBACK_ALLOWLIST is not an array of strings", () => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", CALLBACK_ALLOWLIST: '{"a":1}' }),
    ).toThrow(/CALLBACK_ALLOWLIST must be a JSON array/);
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", CALLBACK_ALLOWLIST: '["ok",2]' }),
    ).toThrow(/CALLBACK_ALLOWLIST must be a JSON array/);
  });

  it.each(["0", "-1", "1.5", "abc"])("fails on invalid PRESIGN_TTL_SECONDS %s", (value) => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", PRESIGN_TTL_SECONDS: value }),
    ).toThrow(/PRESIGN_TTL_SECONDS/);
  });

  it("rejects a presign TTL above the S3 maximum", () => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", PRESIGN_TTL_SECONDS: "604801" }),
    ).toThrow(/PRESIGN_TTL_SECONDS/);
  });

  it.each(["0", "-1", "1.5", "abc"])("fails on invalid MAX_RECEIVE_COUNT %s", (value) => {
    expect(() => loadConfig({ PRINTS_BUCKET: "printer-prints", MAX_RECEIVE_COUNT: value })).toThrow(
      /MAX_RECEIVE_COUNT/,
    );
  });

  it("accepts https and loopback http SQS endpoints", () => {
    expect(
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "https://sqs.example.com",
      }).sqsEndpointUrl,
    ).toBe("https://sqs.example.com");
    expect(
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://localhost:4566",
      }).sqsEndpointUrl,
    ).toBe("http://localhost:4566");
    expect(
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://127.0.0.1:4566/queue",
      }).sqsEndpointUrl,
    ).toBe("http://127.0.0.1:4566/queue");
    expect(
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://[::1]:4566",
      }).sqsEndpointUrl,
    ).toBe("http://[::1]:4566");
  });

  it("fails on an invalid or non-http SQS endpoint", () => {
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", SQS_ENDPOINT_URL: "not-a-url" }),
    ).toThrow(/SQS_ENDPOINT_URL must be a valid http or https URL/);
    expect(() =>
      loadConfig({ PRINTS_BUCKET: "printer-prints", SQS_ENDPOINT_URL: "ftp://localhost:4566" }),
    ).toThrow(/SQS_ENDPOINT_URL must use http or https/);
  });

  it("rejects plain http on a non-loopback host", () => {
    expect(() =>
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://sqs.example.com:4566",
      }),
    ).toThrow(/only allowed for loopback hosts/);
    expect(() =>
      loadConfig({
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://localhost.example.com:4566",
      }),
    ).toThrow(/only allowed for loopback hosts/);
  });
});
