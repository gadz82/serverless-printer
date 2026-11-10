import { describe, expect, it } from "vitest";

import {
  type CompileTemplateOptions,
  TemplateCompileError,
  TemplateRenderError,
  compileTemplate,
} from "../src/index.js";

const render = (
  source: string,
  data: Record<string, unknown>,
  mode: CompileTemplateOptions["mode"],
) => compileTemplate(source, { mode })(data);

describe("compileTemplate missing-field modes", () => {
  it("renders missing leaves and parents as empty in lenient mode", () => {
    expect(render("{{name}}|{{customer.name}}", {}, "lenient")).toBe("|");
  });

  it("fails on any missing field in strict mode", () => {
    expect(() => render("{{name}}", {}, "strict")).toThrow(/template data is missing "name"/);
    expect(() => render("{{customer.name}}", {}, "strict")).toThrow(
      /template data is missing "customer"/,
    );
    expect(() => render("{{customer.name}}", { customer: {} }, "strict")).toThrow(
      /template data is missing "customer.name"/,
    );
    expect(render("{{customer.name}}", { customer: { name: "Ada" } }, "strict")).toBe("Ada");
  });

  it("fails only on a missing parent object in assume-objects mode", () => {
    expect(render("{{name}}", {}, "assume-objects")).toBe("");
    expect(render("{{customer.name}}", { customer: {} }, "assume-objects")).toBe("");
    expect(() => render("{{customer.name}}", {}, "assume-objects")).toThrow(
      /template data is missing "customer"/,
    );
  });

  it("checks block conditions and collections before rendering", () => {
    expect(render("{{#if missing}}yes{{/if}}", {}, "lenient")).toBe("");
    expect(render("{{#if missing}}yes{{/if}}", {}, "assume-objects")).toBe("");
    expect(() => render("{{#if missing}}yes{{/if}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );

    expect(render("{{#unless missing}}yes{{/unless}}", {}, "assume-objects")).toBe("yes");
    expect(() => render("{{#unless missing}}yes{{/unless}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );

    expect(render("{{#each missing}}x{{/each}}", {}, "lenient")).toBe("");
    expect(() => render("{{#each missing}}x{{/each}}", {}, "assume-objects")).toThrow(
      /template data is missing "missing"/,
    );
    expect(() => render("{{#each missing}}x{{/each}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );

    expect(render("{{#with missing}}x{{/with}}", {}, "lenient")).toBe("");
    expect(() => render("{{#with missing}}x{{/with}}", {}, "assume-objects")).toThrow(
      /template data is missing "missing"/,
    );
    expect(() => render("{{#with missing}}x{{/with}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );
  });

  it("checks collection and object shapes in assume-objects mode", () => {
    expect(render("{{#each items}}x{{/each}}", { items: null }, "strict")).toBe("");
    expect(() => render("{{#each items}}x{{/each}}", { items: {} }, "assume-objects")).toThrow(
      /template data "items" must be an array/,
    );
    expect(() =>
      render("{{#with customer}}x{{/with}}", { customer: false }, "assume-objects"),
    ).toThrow(/template data "customer" must be an object/);
  });

  it("recurses through nested objects and arrays", () => {
    expect(() => render("{{items.0.name}}", { items: [{}] }, "strict")).toThrow(
      /template data is missing "items.0.name"/,
    );
    expect(render("{{items.0.name}}", { items: [{ name: "Ada" }] }, "strict")).toBe("Ada");
    expect(render("{{items.0.name}}", { items: [{}] }, "assume-objects")).toBe("");
    expect(() => render("{{items.0.name}}", {}, "assume-objects")).toThrow(
      /template data is missing "items"/,
    );
  });

  it("checks helper arguments and keeps missing values empty outside strict mode", () => {
    expect(render("{{formatCurrency missing}}|{{formatDate missing}}", {}, "lenient")).toBe("|");
    expect(render("{{formatCurrency missing}}|{{formatDate missing}}", {}, "assume-objects")).toBe(
      "|",
    );
    expect(() => render("{{formatCurrency missing}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );
    expect(() => render("{{formatDate missing}}", {}, "strict")).toThrow(
      /template data is missing "missing"/,
    );
  });

  it("handles null helper values as requested per mode", () => {
    expect(
      render("{{formatCurrency value}}|{{formatDate value}}", { value: null }, "lenient"),
    ).toBe("|");
    expect(
      render("{{formatCurrency value}}|{{formatDate value}}", { value: null }, "assume-objects"),
    ).toBe("|");
    expect(() => render("{{formatCurrency value}}", { value: null }, "strict")).toThrow(
      TemplateRenderError,
    );
  });

  it("applies strict helper checks in contexts the placeholder tree cannot pre-check", () => {
    const source = "{{#each items}}{{formatCurrency amount}}{{/each}}";

    expect(render(source, { items: [{}] }, "lenient")).toBe("");
    expect(render(source, { items: [{}] }, "assume-objects")).toBe("");
    expect(() => render(source, { items: [{}] }, "strict")).toThrow(
      /formatCurrency requires a value in strict mode/,
    );
    expect(render(source, { items: [{ amount: 12 }] }, "strict")).toBe("$12.00");
  });
});

describe("control helper modes in nested contexts", () => {
  it("enforces strict if values inside each item contexts", () => {
    const source = "{{#each items}}{{#if active}}x{{/if}}{{/each}}";

    expect(() => render(source, { items: [{}] }, "strict")).toThrow(TemplateRenderError);
    expect(() => render(source, { items: [{}] }, "strict")).toThrow(/if requires a value/);
    expect(render(source, { items: [{}] }, "lenient")).toBe("");
    expect(render(source, { items: [{}] }, "assume-objects")).toBe("");
    expect(render(source, { items: [{ active: false }] }, "strict")).toBe("");
    expect(render(source, { items: [{ active: null }] }, "strict")).toBe("");
    expect(render(source, { items: [{ active: true }] }, "strict")).toBe("x");
  });

  it("enforces strict eq arguments inside each item contexts", () => {
    const source = '{{#each items}}{{#if (eq status "active")}}x{{/if}}{{/each}}';

    expect(() => render(source, { items: [{}] }, "strict")).toThrow(TemplateRenderError);
    expect(() => render(source, { items: [{}] }, "strict")).toThrow(
      /eq requires defined arguments/,
    );
    expect(render(source, { items: [{}] }, "assume-objects")).toBe("");
    expect(render(source, { items: [{ status: "active" }] }, "strict")).toBe("x");
  });

  it("requires each and with parents in assume-objects nested contexts", () => {
    const withSource = "{{#each items}}{{#with customer}}{{name}}{{/with}}{{/each}}";

    expect(() => render(withSource, { items: [{}] }, "assume-objects")).toThrow(
      /with requires a value in assume-objects mode/,
    );
    expect(render(withSource, { items: [{ customer: { name: "Ada" } }] }, "assume-objects")).toBe(
      "Ada",
    );

    const eachSource = "{{#with customer}}{{#each items}}{{name}}{{/each}}{{/with}}";

    expect(() => render(eachSource, { customer: {} }, "assume-objects")).toThrow(
      /each requires a value in assume-objects mode/,
    );
    expect(render(eachSource, { customer: { items: [{ name: "Ada" }] } }, "assume-objects")).toBe(
      "Ada",
    );
  });

  it("enforces strict if values inside bare sections", () => {
    const source = "{{#person}}{{#if active}}x{{/if}}{{/person}}";

    expect(() => render(source, { person: {} }, "strict")).toThrow(
      /if requires a value in strict mode/,
    );
    expect(render(source, { person: { active: false } }, "strict")).toBe("");
    expect(render(source, { person: { active: true } }, "strict")).toBe("x");
  });

  it("keeps null and false present in strict mode", () => {
    const ifSource = "{{#if value}}yes{{else}}no{{/if}}";

    expect(render(ifSource, { value: null }, "strict")).toBe("no");
    expect(render(ifSource, { value: false }, "strict")).toBe("no");
    expect(render("{{#unless value}}yes{{else}}no{{/unless}}", { value: null }, "strict")).toBe(
      "yes",
    );
    expect(render("{{#each items}}x{{/each}}", { items: null }, "strict")).toBe("");
    expect(render("{{#each items}}x{{/each}}", { items: false }, "strict")).toBe("");
    expect(render("{{#with customer}}yes{{/with}}", { customer: null }, "strict")).toBe("");
    expect(render("{{#with customer}}yes{{/with}}", { customer: false }, "strict")).toBe("");
    expect(render("{{eq value false}}", { value: false }, "strict")).toBe("true");
  });

  it("keeps undefined present-property checks strict in nested contexts", () => {
    expect(() => render("{{#if value}}yes{{/if}}", { value: undefined }, "strict")).toThrow(
      /if requires a value in strict mode/,
    );
  });

  it("delegates to built-in each and with while preserving contexts", () => {
    const source =
      "{{#each items}}{{@index}}:{{name}};{{/each}}|{{#with customer}}{{name}}{{/with}}";

    expect(
      render(
        source,
        { items: [{ name: "a" }, { name: "b" }], customer: { name: "Ada" } },
        "strict",
      ),
    ).toBe("0:a;1:b;|Ada");
  });

  it("keeps lenient nested contexts empty without throwing", () => {
    expect(
      render(
        "{{#each items}}{{#with customer}}{{name}}{{/with}}{{/each}}",
        { items: [{}] },
        "lenient",
      ),
    ).toBe("");
    expect(
      render(
        "{{#with customer}}{{#each items}}{{name}}{{/each}}{{/with}}",
        { customer: {} },
        "lenient",
      ),
    ).toBe("");
    expect(render("{{#person}}{{#if active}}x{{/if}}{{/person}}", { person: {} }, "lenient")).toBe(
      "",
    );
  });

  it("keeps assume-objects if, unless and eq fallback semantics", () => {
    expect(render("{{#if missing}}yes{{else}}no{{/if}}", {}, "assume-objects")).toBe("no");
    expect(render("{{#unless missing}}yes{{else}}no{{/unless}}", {}, "assume-objects")).toBe("yes");
    expect(render('{{eq missing "active"}}', {}, "assume-objects")).toBe("false");
    expect(render('{{#if (eq missing "active")}}yes{{else}}no{{/if}}', {}, "assume-objects")).toBe(
      "no",
    );
  });
});

describe("compileTemplate output contract", () => {
  it("keeps HTML escaping on", () => {
    expect(render("<p>{{html}}</p>", { html: "<script>x</script>" }, "lenient")).toBe(
      "<p>&lt;script&gt;x&lt;/script&gt;</p>",
    );
  });

  it("renders the fixed eq helper", () => {
    const source = '{{#if (eq status "active")}}active{{else}}inactive{{/if}}';

    expect(render(source, { status: "active" }, "lenient")).toBe("active");
    expect(render(source, { status: "paused" }, "lenient")).toBe("inactive");
  });

  it("renders formatCurrency with defaults and explicit arguments", () => {
    const source = '{{formatCurrency amount}}|{{formatCurrency amount "EUR"}}';

    expect(render(source, { amount: 1234.5 }, "lenient")).toBe("$1,234.50|€1,234.50");
  });

  it("renders formatDate in UTC", () => {
    const source = '{{formatDate issuedAt}}|{{formatDate issuedAt "en-GB"}}';

    expect(render(source, { issuedAt: "2024-03-15T23:30:00Z" }, "lenient")).toBe(
      "Mar 15, 2024|15 Mar 2024",
    );
  });

  it("supports bare sections and inverted sections", () => {
    const section = compileTemplate("{{#person}}{{name}}{{/person}}", { mode: "lenient" });
    const inverted = compileTemplate("{{^missing}}empty{{/missing}}", { mode: "lenient" });

    expect(section({ person: { name: "Ada" } })).toBe("Ada");
    expect(inverted({})).toBe("empty");
  });

  it("fails compilation for an unregistered helper", () => {
    expect(() => compileTemplate("{{shout name}}", { mode: "lenient" })).toThrow(
      TemplateCompileError,
    );
    expect(() => compileTemplate("{{shout name}}", { mode: "lenient" })).toThrow(
      /unknown template helper "shout"/,
    );
    expect(() => compileTemplate("{{#shout name}}loud{{/shout}}", { mode: "lenient" })).toThrow(
      /unknown template helper "shout"/,
    );
    expect(() => compileTemplate("{{person name}}", { mode: "lenient" })).toThrow(
      /unknown template helper "person"/,
    );
  });

  it("rejects the log helper and other non-contract helpers", () => {
    expect(() => compileTemplate("{{log name}}", { mode: "lenient" })).toThrow(
      /unknown template helper "log"/,
    );
    expect(() => compileTemplate("{{log}}", { mode: "lenient" })).toThrow(
      /unknown template helper "log"/,
    );
    expect(() => compileTemplate("{{lookup obj key}}", { mode: "lenient" })).toThrow(
      /unknown template helper "lookup"/,
    );
  });

  it("rejects prototype-polluted mode names", () => {
    for (const mode of ["constructor", "__proto__"]) {
      const options = { mode } as unknown as CompileTemplateOptions;

      expect(() => compileTemplate("ok", options)).toThrow(/unknown Handlebars mode/);
    }
  });

  it("rejects partials and decorators", () => {
    expect(() => compileTemplate("{{> header}}", { mode: "lenient" })).toThrow(
      /partials are not supported/,
    );
    expect(() => compileTemplate("{{#> layout}}x{{/layout}}", { mode: "lenient" })).toThrow(
      /partials are not supported/,
    );
    expect(() => compileTemplate('{{#*inline "row"}}x{{/inline}}', { mode: "lenient" })).toThrow(
      /decorators are not supported/,
    );
  });

  it("refuses helper names outside the fixed set", () => {
    const options = {
      mode: "lenient",
      helpers: { shout: () => "loud" },
    } as unknown as CompileTemplateOptions;

    expect(() => compileTemplate("{{shout name}}", options)).toThrow(
      /unknown template helper "shout"/,
    );
  });

  it("allows replacing a fixed helper implementation", () => {
    const template = compileTemplate("{{formatDate issuedAt}}", {
      mode: "lenient",
      helpers: { formatDate: () => "fixed-date" },
    });

    expect(template({ issuedAt: "2024-03-15T00:00:00Z" })).toBe("fixed-date");
  });

  it("rejects prototype path segments without polluting Object.prototype", () => {
    expect(() => compileTemplate("{{__proto__.polluted}}", { mode: "lenient" })).toThrow(
      TemplateCompileError,
    );
    expect(() => compileTemplate("{{__proto__.__proto__.x}}", { mode: "lenient" })).toThrow(
      /forbidden template path segment "__proto__"/,
    );
    expect(() => compileTemplate("{{constructor.name}}", { mode: "lenient" })).toThrow(
      /forbidden template path segment "constructor"/,
    );
    expect(() =>
      compileTemplate("{{#each items __proto__=value}}x{{/each}}", { mode: "lenient" }),
    ).toThrow(/forbidden template path segment "__proto__"/);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("keeps prototype properties and methods out of the data scope", () => {
    const template = compileTemplate("{{toString}}|{{name}}", { mode: "lenient" });
    const data: Record<string, unknown> = Object.create({ secret: "leak" });
    data["name"] = "Ada";

    expect(template(data)).toBe("|Ada");
  });

  it("is deterministic for the same source and data", () => {
    const template = compileTemplate("{{formatDate issuedAt}}", { mode: "lenient" });
    const data = { issuedAt: "2024-03-15T00:00:00Z" };

    expect(template(data)).toBe(template(data));
  });
});
