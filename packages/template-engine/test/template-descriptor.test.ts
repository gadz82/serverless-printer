import { describe, expect, it } from "vitest";

import { TemplateDescriptorError, validateTemplateDescriptor } from "../src/index.js";

const descriptor = {
  id: "72803074-1601-4a08-a5a5-49db9feacd66",
  slug: "_smoke",
  name: "Smoke test",
  description: "Minimal template",
};

describe("validateTemplateDescriptor", () => {
  it("accepts the reserved smoke slug and returns the known fields", () => {
    expect(validateTemplateDescriptor(descriptor)).toEqual(descriptor);
  });

  it("accepts a public slug", () => {
    expect(validateTemplateDescriptor({ ...descriptor, slug: "annual-statement" })).toMatchObject({
      slug: "annual-statement",
    });
  });

  it("accepts every UUID v4 variant nibble", () => {
    for (const variant of ["8", "9", "a", "b"]) {
      expect(
        validateTemplateDescriptor({
          ...descriptor,
          id: `72803074-1601-4a08-${variant}5a5-49db9feacd66`,
        }).id,
      ).toBe(`72803074-1601-4a08-${variant}5a5-49db9feacd66`);
    }
  });

  it("accepts UUID v4 ids in either case", () => {
    const upperCaseId = descriptor.id.toUpperCase();

    expect(validateTemplateDescriptor({ ...descriptor, id: upperCaseId }).id).toBe(upperCaseId);
  });

  it("rejects non-object descriptors", () => {
    expect(() => validateTemplateDescriptor(null)).toThrow(/must be an object/);
    expect(() => validateTemplateDescriptor([])).toThrow(/must be an object/);
  });

  it("rejects missing or empty identity fields", () => {
    expect(() => validateTemplateDescriptor({ ...descriptor, id: "" })).toThrow(
      /non-empty string "id"/,
    );
    expect(() => validateTemplateDescriptor({ ...descriptor, slug: "  " })).toThrow(
      /non-empty string "slug"/,
    );
    expect(() => validateTemplateDescriptor({ ...descriptor, name: 42 })).toThrow(
      /non-empty string "name"/,
    );
    expect(() => validateTemplateDescriptor({ ...descriptor, description: undefined })).toThrow(
      /non-empty string "description"/,
    );
    expect(() => validateTemplateDescriptor({ ...descriptor, description: "" })).toThrow(
      /non-empty string "description"/,
    );
  });

  it("rejects ids that are not lower-case UUID v4 values", () => {
    for (const id of [
      "not-a-uuid",
      "72803074-1601-3a08-a5a5-49db9feacd66",
      "72803074-1601-5a08-a5a5-49db9feacd66",
      "72803074-1601-4a08-c5a5-49db9feacd66",
    ]) {
      expect(() => validateTemplateDescriptor({ ...descriptor, id })).toThrow(
        TemplateDescriptorError,
      );
    }
  });

  it("rejects every underscore slug except _smoke", () => {
    expect(() => validateTemplateDescriptor({ ...descriptor, slug: "_internal" })).toThrow(
      /only "_smoke" may start with an underscore/,
    );
  });

  it("rejects malformed public slugs", () => {
    for (const slug of ["ab", "1template", "Uppercase", "with_underscore", "with space"]) {
      expect(() => validateTemplateDescriptor({ ...descriptor, slug })).toThrow(
        TemplateDescriptorError,
      );
    }
  });
});
