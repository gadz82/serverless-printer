import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";

import {
  assertValidJob,
  ContractValidationError,
  formatValidationErrors,
  toValidationIssues,
  validateJob,
} from "../src/index.js";
import { minimalJob } from "./fixtures/job.fixtures.js";

function errorsFor(value: unknown): readonly ErrorObject[] {
  expect(validateJob(value)).toBe(false);

  const errors = validateJob.errors;
  if (errors === null || errors === undefined) {
    throw new Error("expected validation errors for an invalid job");
  }

  return errors;
}

describe("validation error formatting", () => {
  it("returns an empty string when there are no errors", () => {
    expect(formatValidationErrors(null)).toBe("");
    expect(formatValidationErrors(undefined)).toBe("");
    expect(formatValidationErrors([])).toBe("");
  });

  it("formats Ajv errors with an instance path, keyword and message", () => {
    const errors = errorsFor({
      ...minimalJob,
      templateId: "Invalid Slug",
      unexpected: true,
    });

    const formatted = formatValidationErrors(errors);

    expect(formatted).toContain("/templateId [pattern] must match pattern");
    expect(formatted).toContain("/ [additionalProperties] must NOT have additional properties");
    expect(formatted).not.toContain("undefined");
  });

  it("is stable regardless of the input error order", () => {
    const errors = errorsFor({
      ...minimalJob,
      templateId: "Invalid Slug",
      refId: [],
      unexpected: true,
    });

    const first = formatValidationErrors(errors);
    const second = formatValidationErrors([...errors].reverse());

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("sorts issues by path, keyword and message", () => {
    const issues = toValidationIssues(errorsFor({ ...minimalJob, templateId: "Invalid Slug" }));
    const sorted = [...issues].sort((left, right) => {
      const leftKey = `${left.path}\u0000${left.keyword}\u0000${left.message}`;
      const rightKey = `${right.path}\u0000${right.keyword}\u0000${right.message}`;

      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

    expect(issues).toEqual(sorted);
  });

  it("maps the root instance path to /", () => {
    const issues = toValidationIssues(errorsFor({ ...minimalJob, extra: "field" }));

    expect(issues.some((issue) => issue.path === "/")).toBe(true);
  });

  it("throws a named contract error with stable issues from assertValidJob", () => {
    expect(() => assertValidJob(minimalJob)).not.toThrow();

    try {
      assertValidJob({ ...minimalJob, templateId: "Invalid Slug" });
      throw new Error("expected assertValidJob to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      if (!(error instanceof ContractValidationError)) {
        throw error;
      }

      expect(error.name).toBe("ContractValidationError");
      expect(error.contract).toBe("job");
      expect(error.issues.length).toBeGreaterThan(0);
      expect(error.message).toContain("invalid job contract");
      expect(error.message).toContain("/templateId [pattern]");
    }
  });
});
