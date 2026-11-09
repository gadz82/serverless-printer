import { describe, expect, it } from "vitest";
import { JsonLogger, type WorkerLogFields } from "../src/logger.js";

function capture(): { lines: string[]; logger: JsonLogger } {
  const lines: string[] = [];
  const logger = new JsonLogger(
    { log: (message) => lines.push(message) },
    () => new Date("2026-11-09T10:00:00.000Z"),
  );
  return { lines, logger };
}

describe("JsonLogger", () => {
  it("writes one structured JSON object per call with the allowlisted fields", () => {
    const { lines, logger } = capture();

    logger.info("print_job_succeeded", {
      printId: "print-1",
      templateId: "template-1",
      messageId: "message-1",
      attempt: 2,
      errorCode: "DELIVERY_FAILED",
      durationMs: 17,
    });
    logger.warn("print_job_retry");
    logger.error("print_job_failed", { errorCode: "INVALID_MESSAGE" });

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      level: "info",
      event: "print_job_succeeded",
      timestamp: "2026-11-09T10:00:00.000Z",
      printId: "print-1",
      templateId: "template-1",
      messageId: "message-1",
      attempt: 2,
      errorCode: "DELIVERY_FAILED",
      durationMs: 17,
    });
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      level: "warn",
      event: "print_job_retry",
      timestamp: "2026-11-09T10:00:00.000Z",
    });
    expect(JSON.parse(lines[2] ?? "")).toEqual({
      level: "error",
      event: "print_job_failed",
      timestamp: "2026-11-09T10:00:00.000Z",
      errorCode: "INVALID_MESSAGE",
    });
  });

  it("drops fields outside the allowlist even when a caller smuggles them in", () => {
    const { lines, logger } = capture();
    const smuggled = {
      messageId: "message-1",
      refId: "customer-secret",
      payload: { email: "person@example.com" },
      html: "<p>secret</p>",
      pdfBytes: "JVBERi0=",
    } as unknown as WorkerLogFields;

    logger.info("print_job_succeeded", smuggled);

    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(entry["messageId"]).toBe("message-1");
    expect(entry).not.toHaveProperty("refId");
    expect(entry).not.toHaveProperty("payload");
    expect(entry).not.toHaveProperty("html");
    expect(entry).not.toHaveProperty("pdfBytes");
    expect(Object.keys(entry).sort()).toEqual(["event", "level", "messageId", "timestamp"]);
  });
});
