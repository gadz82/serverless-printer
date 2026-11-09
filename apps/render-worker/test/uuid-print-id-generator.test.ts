import { v5 as uuidv5 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  PRINT_ID_NAMESPACE,
  UuidPrintIdGenerator,
} from "../src/adapters/uuid-print-id-generator.js";

describe("UuidPrintIdGenerator", () => {
  it("derives a UUIDv5 from the committed namespace and the inbound message id", () => {
    const generator = new UuidPrintIdGenerator();

    expect(generator.forMessage("message-123")).toBe("302d1854-6ba6-5f39-a77c-029d2052145b");
    expect(generator.forMessage("message-123")).toBe(uuidv5("message-123", PRINT_ID_NAMESPACE));
    expect(generator.forMessage("message-123")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is deterministic per message and distinct across messages", () => {
    const generator = new UuidPrintIdGenerator();

    expect(generator.forMessage("message-1")).toBe(generator.forMessage("message-1"));
    expect(generator.forMessage("message-1")).not.toBe(generator.forMessage("message-2"));
  });

  it("uses a valid v4 namespace constant", () => {
    expect(PRINT_ID_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
