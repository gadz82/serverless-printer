import Handlebars from "handlebars";

import { TemplateCompileError, errorMessage } from "./errors.js";

const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export type AstProgram = {
  readonly type: "Program";
  readonly body: readonly AstStatement[];
};

export type AstStatement =
  | AstBlockStatement
  | AstMustacheStatement
  | AstPartialStatement
  | AstPartialBlockStatement
  | AstContentStatement
  | AstCommentStatement
  | AstDecorator;

export type AstBlockStatement = {
  readonly type: "BlockStatement";
  readonly path: AstExpression;
  readonly params: readonly AstExpression[];
  readonly hash?: AstHash;
  readonly program?: AstProgram;
  readonly inverse?: AstProgram;
  readonly loc?: AstSourceLocation;
};

export type AstSourceLocation = {
  readonly start: {
    readonly line: number;
    readonly column: number;
  };
};

export type AstMustacheStatement = {
  readonly type: "MustacheStatement";
  readonly path: AstExpression;
  readonly params: readonly AstExpression[];
  readonly hash?: AstHash;
};

export type AstPartialStatement = {
  readonly type: "PartialStatement";
  readonly name: AstExpression;
  readonly params: readonly AstExpression[];
  readonly hash?: AstHash;
};

export type AstPartialBlockStatement = {
  readonly type: "PartialBlockStatement";
  readonly name: AstExpression;
  readonly params: readonly AstExpression[];
  readonly hash?: AstHash;
  readonly program?: AstProgram;
};

export type AstContentStatement = {
  readonly type: "ContentStatement";
};

export type AstCommentStatement = {
  readonly type: "CommentStatement";
};

export type AstDecorator = {
  readonly type: "Decorator" | "DecoratorBlock";
  readonly path?: AstExpression;
  readonly params?: readonly AstExpression[];
  readonly hash?: AstHash;
  readonly program?: AstProgram;
};

export type AstExpression =
  | AstPathExpression
  | AstSubExpression
  | AstStringLiteral
  | AstNumberLiteral
  | AstBooleanLiteral
  | AstUndefinedLiteral
  | AstNullLiteral;

export type AstPathExpression = {
  readonly type: "PathExpression";
  readonly data: boolean;
  readonly depth: number;
  readonly parts: readonly string[];
  readonly original: string;
};

export type AstSubExpression = {
  readonly type: "SubExpression";
  readonly path: AstExpression;
  readonly params: readonly AstExpression[];
  readonly hash?: AstHash;
};

export type AstStringLiteral = {
  readonly type: "StringLiteral";
  readonly value: string;
};

export type AstNumberLiteral = {
  readonly type: "NumberLiteral";
  readonly value: number;
};

export type AstBooleanLiteral = {
  readonly type: "BooleanLiteral";
  readonly value: boolean;
};

export type AstUndefinedLiteral = {
  readonly type: "UndefinedLiteral";
};

export type AstNullLiteral = {
  readonly type: "NullLiteral";
};

export type AstHash = {
  readonly type: "Hash";
  readonly pairs: readonly AstHashPair[];
};

export type AstHashPair = {
  readonly type: "HashPair";
  readonly key: string;
  readonly value: AstExpression;
};

export function assertSafePath(path: AstPathExpression): void {
  for (const segment of path.parts) {
    assertSafePathSegment(segment, path.original);
  }
}

export function assertSafePathSegment(segment: string, original: string): void {
  if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
    throw new TemplateCompileError(`forbidden template path segment "${segment}" in "${original}"`);
  }
}

export function parseTemplate(source: string): AstProgram {
  let parsed: unknown;

  try {
    parsed = Handlebars.parse(source);
  } catch (error) {
    throw new TemplateCompileError(`invalid Handlebars template: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  if (!isProgram(parsed)) {
    throw new TemplateCompileError("Handlebars parser returned an unexpected AST");
  }

  return parsed;
}

function isProgram(value: unknown): value is AstProgram {
  return isRecord(value) && value["type"] === "Program" && Array.isArray(value["body"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
