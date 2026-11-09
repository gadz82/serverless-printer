import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import jobSchemaDocument from "../schemas/job.schema.json" with { type: "json" };
import resultSchemaDocument from "../schemas/result.schema.json" with { type: "json" };
import type { PrintJob } from "./generated/job.js";
import type { PrintResult } from "./generated/result.js";

export const jobSchema = jobSchemaDocument;
export const resultSchema = resultSchemaDocument;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

// ORCHID-MEM: 01a1c1d8-f018-7fa1-8f4a-34775562fc02 — Validates inbound print jobs against the JSON Schema contract before domain mapping.
export const validateJob: ValidateFunction<PrintJob> = ajv.compile<PrintJob>(jobSchema);
// ORCHID-MEM: 01a1c1d8-f085-734b-9df3-a3da92ea4d6c — Validates outbound results against the JSON Schema contract, including error codes and metadata.
export const validateResult: ValidateFunction<PrintResult> = ajv.compile<PrintResult>(resultSchema);

export type ValidationIssue = {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
};

// localeCompare depends on the host locale; code-unit order keeps error output stable everywhere.
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

export function toValidationIssues(
  errors: readonly ErrorObject[] | null | undefined,
): readonly ValidationIssue[] {
  const issues = (errors ?? []).map((error): ValidationIssue => ({
    path: error.instancePath.length === 0 ? "/" : error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "is invalid",
  }));

  return issues.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.keyword, right.keyword) ||
      compareText(left.message, right.message),
  );
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} [${issue.keyword}] ${issue.message}`).join("; ");
}

export function formatValidationErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return formatIssues(toValidationIssues(errors));
}

export class ContractValidationError extends Error {
  constructor(
    readonly contract: "job" | "result",
    readonly issues: readonly ValidationIssue[],
  ) {
    super(`invalid ${contract} contract: ${formatIssues(issues)}`);
    this.name = "ContractValidationError";
  }
}

export function assertValidJob(value: unknown): asserts value is PrintJob {
  if (!validateJob(value)) {
    throw new ContractValidationError("job", toValidationIssues(validateJob.errors));
  }
}

export function assertValidResult(value: unknown): asserts value is PrintResult {
  if (!validateResult(value)) {
    throw new ContractValidationError("result", toValidationIssues(validateResult.errors));
  }
}
