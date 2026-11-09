import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, jobSchema, resultSchema } from "../src/index.js";

describe("contract metadata", () => {
  it("publishes contract version 1.0.0", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
  });

  it("versions both schema ids with the published contract version", () => {
    expect(jobSchema.$id).toBe(`https://printer.dev/contracts/${CONTRACT_VERSION}/job.schema.json`);
    expect(resultSchema.$id).toBe(
      `https://printer.dev/contracts/${CONTRACT_VERSION}/result.schema.json`,
    );
  });

  it("uses the JSON Schema 2020-12 dialect", () => {
    expect(jobSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(resultSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("keeps both schemas closed at every contract-owned object level", () => {
    expect(jobSchema.additionalProperties).toBe(false);
    expect(resultSchema.$defs.printSuccessResult.additionalProperties).toBe(false);
    expect(resultSchema.$defs.printFailureResult.additionalProperties).toBe(false);
  });
});
