import { TemplateDescriptorError } from "./errors.js";

export type TemplateDescriptor = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
};

const RESERVED_SMOKE_SLUG = "_smoke";
const PUBLIC_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateTemplateDescriptor(descriptor: unknown): TemplateDescriptor {
  if (!isRecord(descriptor)) {
    throw new TemplateDescriptorError("template descriptor must be an object");
  }

  const id = requiredString(descriptor["id"], "id");
  assertUuidV4(id);
  const slug = requiredString(descriptor["slug"], "slug");
  const name = requiredString(descriptor["name"], "name");
  const description = requiredString(descriptor["description"], "description");
  assertSlug(slug);

  return { id, slug, name, description };
}

function assertUuidV4(id: string): void {
  if (!UUID_V4_PATTERN.test(id)) {
    throw new TemplateDescriptorError(`template descriptor id "${id}" must be a UUID v4`);
  }
}

function assertSlug(slug: string): void {
  if (slug === RESERVED_SMOKE_SLUG) {
    return;
  }

  if (slug.startsWith("_")) {
    throw new TemplateDescriptorError(
      `Invalid slug "${slug}": only "${RESERVED_SMOKE_SLUG}" may start with an underscore.`,
    );
  }

  if (!PUBLIC_SLUG_PATTERN.test(slug)) {
    throw new TemplateDescriptorError(
      `Invalid slug "${slug}": expected ${String(PUBLIC_SLUG_PATTERN)}.`,
    );
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TemplateDescriptorError(
      `template descriptor must define a non-empty string "${field}"`,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
