import Handlebars from "handlebars";

import type { AstBlockStatement, AstExpression, AstHash, AstProgram, AstStatement } from "./ast.js";
import { assertSafePath, assertSafePathSegment, parseTemplate } from "./ast.js";
import { TemplateCompileError, TemplateRenderError, errorMessage } from "./errors.js";
import { extractPlaceholdersFromProgram } from "./extract-placeholders.js";
import type { FixedHelpers } from "./helpers.js";
import {
  FIXED_HELPER_NAMES,
  defaultFixedHelpers,
  isFixedHelperName,
  isKnownHelperName,
} from "./helpers.js";
import { validateTemplateData } from "./validate-template-data.js";

export type HandlebarsMode = "lenient" | "strict" | "assume-objects";

export type TemplateData = Readonly<Record<string, unknown>>;

export type CompiledTemplate = (data?: TemplateData) => string;

export type CompileTemplateOptions = {
  readonly mode: HandlebarsMode;
  readonly helpers?: Partial<FixedHelpers>;
};

type ModeSettings = {
  readonly strict: boolean;
  readonly assumeObjects: boolean;
};

const KNOWN_HELPERS = {
  eq: true,
  formatCurrency: true,
  formatDate: true,
};

/**
 * Compiles a Handlebars source with one of the three supported missing-field
 * modes. The returned renderer keeps escaping and prototype access off.
 */
export function compileTemplate(source: string, options: CompileTemplateOptions): CompiledTemplate {
  const mode = options.mode;
  const modeSettings = readModeSettings(mode);
  const helpers = readHelpers(options.helpers);

  const program = parseTemplate(source);
  assertOnlyFixedHelpers(program);
  const placeholders = extractPlaceholdersFromProgram(program, source);

  const environment = Handlebars.create();
  environment.unregisterHelper("log");
  environment.unregisterHelper("lookup");
  const builtInHelpers = readBuiltInHelpers(environment);
  registerHelpers(environment, helpers, mode, builtInHelpers);

  let template: ReturnType<typeof environment.compile<TemplateData>>;
  try {
    template = environment.compile<TemplateData>(source, {
      strict: modeSettings.strict,
      assumeObjects: modeSettings.assumeObjects,
      noEscape: false,
      knownHelpers: KNOWN_HELPERS,
      knownHelpersOnly: true,
    });
  } catch (error) {
    throw new TemplateCompileError(`cannot compile Handlebars template: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  return (data: TemplateData = {}) => {
    validateTemplateData(placeholders, data, mode);

    try {
      return template(data, {
        allowProtoPropertiesByDefault: false,
        allowProtoMethodsByDefault: false,
      });
    } catch (error) {
      if (error instanceof TemplateRenderError) {
        throw error;
      }

      throw new TemplateRenderError(`template render failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  };
}

function readModeSettings(mode: HandlebarsMode): ModeSettings {
  switch (mode) {
    case "lenient":
      return { strict: false, assumeObjects: false };
    case "strict":
      return { strict: true, assumeObjects: false };
    case "assume-objects":
      return { strict: false, assumeObjects: true };
    default:
      throw new TemplateCompileError(`unknown Handlebars mode "${String(mode)}"`);
  }
}

function readHelpers(overrides: Partial<FixedHelpers> | undefined): FixedHelpers {
  if (overrides === undefined) {
    return defaultFixedHelpers;
  }

  for (const name of Object.keys(overrides)) {
    if (!isFixedHelperName(name)) {
      throw new TemplateCompileError(
        `unknown template helper "${name}"; allowed helpers are ${FIXED_HELPER_NAMES.join(", ")}`,
      );
    }
  }

  return {
    eq: overrides.eq ?? defaultFixedHelpers.eq,
    formatCurrency: overrides.formatCurrency ?? defaultFixedHelpers.formatCurrency,
    formatDate: overrides.formatDate ?? defaultFixedHelpers.formatDate,
  };
}

type BuiltInHelpers = {
  readonly if: Handlebars.HelperDelegate;
  readonly unless: Handlebars.HelperDelegate;
  readonly each: Handlebars.HelperDelegate;
  readonly with: Handlebars.HelperDelegate;
};

function readBuiltInHelpers(environment: typeof Handlebars): BuiltInHelpers {
  return {
    if: readBuiltInHelper(environment, "if"),
    unless: readBuiltInHelper(environment, "unless"),
    each: readBuiltInHelper(environment, "each"),
    with: readBuiltInHelper(environment, "with"),
  };
}

function readBuiltInHelper(
  environment: typeof Handlebars,
  name: string,
): Handlebars.HelperDelegate {
  const helper = environment.helpers[name];
  if (helper === undefined) {
    throw new TemplateCompileError(`Handlebars built-in helper "${name}" is unavailable`);
  }

  return helper;
}

function registerHelpers(
  environment: typeof Handlebars,
  helpers: FixedHelpers,
  mode: HandlebarsMode,
  builtInHelpers: BuiltInHelpers,
): void {
  environment.registerHelper("eq", (...args: readonly unknown[]) => {
    const [left, right] = helperArguments(args);

    if (mode === "strict") {
      assertDefinedHelperArgument("eq", left);
      assertDefinedHelperArgument("eq", right);
    }

    if (mode === "assume-objects" && (left === undefined || right === undefined)) {
      return false;
    }

    return helpers.eq(left, right);
  });

  environment.registerHelper("formatCurrency", (...args: readonly unknown[]) => {
    const [amount, currency, locale] = helperArguments(args);
    if (amount === undefined) {
      return missingHelperValue("formatCurrency", mode);
    }
    if (amount === null && mode !== "strict") {
      return "";
    }

    return helpers.formatCurrency(amount, optionalString(currency), optionalString(locale));
  });

  environment.registerHelper("formatDate", (...args: readonly unknown[]) => {
    const [value, locale] = helperArguments(args);
    if (value === undefined) {
      return missingHelperValue("formatDate", mode);
    }
    if (value === null && mode !== "strict") {
      return "";
    }

    return helpers.formatDate(value, optionalString(locale));
  });

  environment.registerHelper("if", function (this: unknown, ...args: unknown[]) {
    assertControlArgument("if", args, mode);
    return callBuiltInHelper(builtInHelpers.if, this, args);
  });

  environment.registerHelper("unless", function (this: unknown, ...args: unknown[]) {
    assertControlArgument("unless", args, mode);
    return callBuiltInHelper(builtInHelpers.unless, this, args);
  });

  environment.registerHelper("each", function (this: unknown, ...args: unknown[]) {
    assertControlArgument("each", args, mode);
    return callBuiltInHelper(builtInHelpers.each, this, args);
  });

  environment.registerHelper("with", function (this: unknown, ...args: unknown[]) {
    assertControlArgument("with", args, mode);
    return callBuiltInHelper(builtInHelpers.with, this, args);
  });
}

function assertControlArgument(
  name: "if" | "unless" | "each" | "with",
  args: readonly unknown[],
  mode: HandlebarsMode,
): void {
  const [first] = helperArguments(args);
  if (first !== undefined) {
    return;
  }

  const missingParent = name === "each" || name === "with";
  if (mode === "strict" || (mode === "assume-objects" && missingParent)) {
    throw new TemplateRenderError(`${name} requires a value in ${mode} mode`);
  }
}

function assertDefinedHelperArgument(name: "eq", value: unknown): void {
  if (value === undefined) {
    throw new TemplateRenderError(`${name} requires defined arguments in strict mode`);
  }
}

function callBuiltInHelper(
  helper: Handlebars.HelperDelegate,
  thisArg: unknown,
  args: readonly unknown[],
): unknown {
  return Reflect.apply(helper, thisArg, args);
}

function missingHelperValue(name: "formatCurrency" | "formatDate", mode: HandlebarsMode): string {
  if (mode === "strict") {
    throw new TemplateRenderError(`${name} requires a value in strict mode`);
  }

  return "";
}

function helperArguments(args: readonly unknown[]): readonly unknown[] {
  // Handlebars always appends a helper-options object after the template arguments.
  return args.length === 0 ? args : args.slice(0, -1);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assertOnlyFixedHelpers(program: AstProgram): void {
  visitProgram(program);
}

function visitProgram(program: AstProgram): void {
  for (const statement of program.body) {
    visitStatement(statement);
  }
}

function visitStatement(statement: AstStatement): void {
  switch (statement.type) {
    case "BlockStatement":
      visitBlockStatement(statement);
      break;
    case "MustacheStatement":
      visitMustacheStatement(statement);
      break;
    case "PartialStatement":
    case "PartialBlockStatement":
      throw new TemplateCompileError("partials are not supported by the fixed template contract");
    case "Decorator":
    case "DecoratorBlock":
      throw new TemplateCompileError("decorators are not supported by the fixed template contract");
    case "ContentStatement":
    case "CommentStatement":
      break;
  }
}

function visitBlockStatement(statement: AstBlockStatement): void {
  if (statement.path.type === "PathExpression") {
    assertSafePath(statement.path);
  }

  const helperName = expressionName(statement.path);
  if (helperName === "log") {
    throw unknownHelper("log");
  }

  const isHelperCall =
    statement.params.length > 0 ||
    (statement.hash?.pairs.length ?? 0) > 0 ||
    (helperName !== undefined && isKnownHelperName(helperName));

  if (isHelperCall) {
    assertHelperPath(statement.path);
  }

  visitExpressions(statement.params);
  visitHash(statement.hash);

  if (statement.program !== undefined) {
    visitProgram(statement.program);
  }
  if (statement.inverse !== undefined) {
    visitProgram(statement.inverse);
  }
}

function visitMustacheStatement(
  statement: Extract<AstStatement, { type: "MustacheStatement" }>,
): void {
  if (statement.path.type === "PathExpression") {
    assertSafePath(statement.path);
    if (statement.path.original === "log") {
      throw unknownHelper("log");
    }
  }

  const isHelperCall =
    statement.params.length > 0 ||
    (statement.hash?.pairs.length ?? 0) > 0 ||
    (statement.path.type === "PathExpression" && isKnownHelperName(statement.path.original));

  if (isHelperCall) {
    assertHelperPath(statement.path);
  } else if (statement.path.type === "SubExpression") {
    visitExpression(statement.path);
  }

  visitExpressions(statement.params);
  visitHash(statement.hash);
}

function visitExpressions(expressions: readonly AstExpression[]): void {
  for (const expression of expressions) {
    visitExpression(expression);
  }
}

function visitHash(hash: AstHash | undefined): void {
  if (hash === undefined) {
    return;
  }

  for (const pair of hash.pairs) {
    assertSafePathSegment(pair.key, pair.key);
    visitExpression(pair.value);
  }
}

function visitExpression(expression: AstExpression): void {
  if (expression.type === "PathExpression") {
    assertSafePath(expression);
    return;
  }

  if (expression.type !== "SubExpression") {
    return;
  }

  if (expression.path.type === "PathExpression") {
    assertSafePath(expression.path);
  }

  assertHelperPath(expression.path);
  visitExpressions(expression.params);
  visitHash(expression.hash);
}

function assertHelperPath(path: AstExpression): void {
  if (path.type !== "PathExpression") {
    return;
  }

  if (!isKnownHelperName(path.original)) {
    throw unknownHelper(path.original);
  }
}

function unknownHelper(name: string): TemplateCompileError {
  return new TemplateCompileError(
    `unknown template helper "${name}"; allowed helpers are ${FIXED_HELPER_NAMES.join(", ")}`,
  );
}

function expressionName(expression: AstExpression): string | undefined {
  return expression.type === "PathExpression" ? expression.original : undefined;
}
