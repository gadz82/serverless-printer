import { describe, expect, it } from "vitest";

import { TemplateCompileError, extractPlaceholders } from "../src/index.js";

describe("extractPlaceholders", () => {
  it("maps eaches to arrays and skips item-context paths", () => {
    expect(extractPlaceholders("{{#each items}}{{label}}{{/each}}")).toEqual({
      items: "array",
    });
  });

  it("maps if and unless to booleans and keeps their body paths", () => {
    expect(
      extractPlaceholders("{{#if active}}{{status}}{{/if}}{{#unless hidden}}{{reason}}{{/unless}}"),
    ).toEqual({
      active: "boolean",
      hidden: "boolean",
      reason: "string",
      status: "string",
    });
  });

  it("maps with to an object and skips object-context paths", () => {
    expect(extractPlaceholders("{{#with customer}}{{name}}{{/with}}")).toEqual({
      customer: "object",
    });
  });

  it("maps bare sections to objects and inverted sections to booleans", () => {
    expect(extractPlaceholders("{{#person}}{{name}}{{/person}}")).toEqual({
      person: "object",
    });
    expect(extractPlaceholders("{{^active}}{{name}}{{/active}}")).toEqual({
      active: "boolean",
      name: "string",
    });
  });

  it("walks both branches of an inverted section safely", () => {
    expect(extractPlaceholders("{{^active}}{{missing}}{{else}}{{fallback}}{{/active}}")).toEqual({
      active: "boolean",
      fallback: "string",
      missing: "string",
    });
  });

  it("keeps only the parent object and inverse paths for a bare section", () => {
    expect(extractPlaceholders("{{#person}}{{name}}{{else}}{{fallback}}{{/person}}")).toEqual({
      fallback: "string",
      person: "object",
    });
  });

  it("turns dotted paths into nested keys", () => {
    expect(extractPlaceholders("{{customer.address.city}}")).toEqual({
      customer: { address: { city: "string" } },
    });
  });

  it("resolves this, current-context, root and parent paths to root keys", () => {
    expect(
      extractPlaceholders("{{this.name}} {{./age}} {{@root.customer.name}} {{../title}}"),
    ).toEqual({
      age: "string",
      customer: { name: "string" },
      name: "string",
      title: "string",
    });

    expect(extractPlaceholders("{{#if active}}{{this.status}}{{../title}}{{/if}}")).toEqual({
      active: "boolean",
      status: "string",
      title: "string",
    });
  });

  it("builds a mixed JSON-safe tree", () => {
    const tree = extractPlaceholders(
      [
        "{{customer.name}}",
        "{{#each items}}{{label}}{{/each}}",
        "{{#if active}}{{status}}{{/if}}",
        "{{#with metadata}}{{value}}{{/with}}",
      ].join("\n"),
    );

    expect(tree).toEqual({
      active: "boolean",
      customer: { name: "string" },
      items: "array",
      metadata: "object",
      status: "string",
    });
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });

  it("does not treat helper names as placeholders", () => {
    expect(
      extractPlaceholders(
        '{{formatCurrency total "USD"}}{{#if (eq status "active")}}{{status}}{{/if}}',
      ),
    ).toEqual({
      status: "string",
      total: "string",
    });
  });

  it("does not descend into each item contexts", () => {
    expect(
      extractPlaceholders("{{#each items}}{{@index}}{{this.name}}{{../title}}{{/each}}"),
    ).toEqual({
      items: "array",
    });
  });

  it("keeps inverse-block paths because they render with the parent context", () => {
    expect(extractPlaceholders("{{#each items}}{{label}}{{else}}{{emptyLabel}}{{/each}}")).toEqual({
      emptyLabel: "string",
      items: "array",
    });
  });

  it("prefers a nested path over an earlier leaf marker", () => {
    expect(extractPlaceholders("{{customer}}{{customer.name}}")).toEqual({
      customer: { name: "string" },
    });
  });

  it("returns keys in deterministic sorted order", () => {
    const tree = extractPlaceholders("{{zebra}}{{alpha}}{{nested.bravo}}");

    expect(Object.keys(tree)).toEqual(["alpha", "nested", "zebra"]);
  });

  it("builds null-prototype trees", () => {
    const tree = extractPlaceholders("{{customer.name}}");
    const customer = tree["customer"];

    expect(Object.getPrototypeOf(tree)).toBeNull();
    expect(customer).toBeDefined();
    expect(typeof customer).toBe("object");
    if (typeof customer === "object" && customer !== null) {
      expect(Object.getPrototypeOf(customer)).toBeNull();
    }
  });

  it("rejects forbidden prototype path segments without polluting Object.prototype", () => {
    expect(() => extractPlaceholders("{{__proto__.polluted}}")).toThrow(TemplateCompileError);
    expect(() => extractPlaceholders("{{__proto__.__proto__.x}}")).toThrow(
      /forbidden template path segment "__proto__"/,
    );
    expect(() => extractPlaceholders("{{a.prototype.b}}")).toThrow(
      /forbidden template path segment "prototype"/,
    );
    expect(() => extractPlaceholders("{{constructor.name}}")).toThrow(
      /forbidden template path segment "constructor"/,
    );
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("rejects malformed Handlebars", () => {
    expect(() => extractPlaceholders("{{#if active}}")).toThrow(/invalid Handlebars template/);
  });
});
