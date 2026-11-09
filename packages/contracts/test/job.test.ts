import { describe, expect, it } from "vitest";

import type { PrintJob } from "../src/index.js";
import { formatValidationErrors, validateJob } from "../src/index.js";
import {
  invalidJobFixtures,
  minimalJob,
  smokeJob,
  validJobFixtures,
} from "./fixtures/job.fixtures.js";

const pdfaLevels = [
  false,
  "PDF/A-1b",
  "PDF/A-1a",
  "PDF/A-2b",
  "PDF/A-2u",
  "PDF/A-2a",
  "PDF/A-3b",
  "PDF/A-3u",
  "PDF/A-3a",
] as const;

describe("job contract", () => {
  it("exposes a valid generated PrintJob type", () => {
    const typedMinimal: PrintJob = minimalJob;
    const typedSmoke: PrintJob = smokeJob;

    expect(validateJob(typedMinimal)).toBe(true);
    expect(validateJob(typedSmoke)).toBe(true);
  });

  it.each(validJobFixtures)("accepts $name", ({ value }) => {
    expect(validateJob(value)).toBe(true);
    expect(validateJob.errors).toBeNull();
  });

  it.each(invalidJobFixtures)("rejects $name", ({ value, path, keyword }) => {
    expect(validateJob(value)).toBe(false);
    expect(validateJob.errors).not.toBeNull();
    expect(formatValidationErrors(validateJob.errors)).toContain(`${path} [${keyword}]`);
  });

  it.each(pdfaLevels)("accepts options.pdfA %s", (pdfA) => {
    const job: PrintJob = {
      ...minimalJob,
      options: { pdfA },
    };

    expect(validateJob(job)).toBe(true);
  });

  it("accepts only the exact reserved _smoke template id", () => {
    expect(validateJob(smokeJob)).toBe(true);
    expect(validateJob({ ...minimalJob, templateId: "_smoke" })).toBe(true);

    expect(validateJob({ ...minimalJob, templateId: "_smoke-2" })).toBe(false);
    expect(validateJob({ ...minimalJob, templateId: "__smoke" })).toBe(false);
  });

  it("accepts uuid, public slug and the reserved slug as templateId", () => {
    expect(validateJob({ ...minimalJob, templateId: "annual-statement" })).toBe(true);
    expect(validateJob({ ...minimalJob, templateId: "6f1c2b0e-8a4d-4f7e-9c1a-2d3b4e5f6a7b" })).toBe(
      true,
    );
    expect(validateJob({ ...minimalJob, templateId: "_smoke" })).toBe(true);
  });

  it("accepts every refId JSON shape the contract allows", () => {
    expect(validateJob({ ...minimalJob, refId: "text" })).toBe(true);
    expect(validateJob({ ...minimalJob, refId: 0 })).toBe(true);
    expect(validateJob({ ...minimalJob, refId: -12.5 })).toBe(true);
    expect(validateJob({ ...minimalJob, refId: { nested: { value: [1, 2] } } })).toBe(true);
    expect(validateJob({ ...minimalJob, refId: [] })).toBe(false);
    expect(validateJob({ ...minimalJob, refId: true })).toBe(false);
    expect(validateJob({ ...minimalJob, refId: null })).toBe(false);
  });
});
