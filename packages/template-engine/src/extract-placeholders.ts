import type {
  AstBlockStatement,
  AstExpression,
  AstHash,
  AstPartialBlockStatement,
  AstPartialStatement,
  AstPathExpression,
  AstProgram,
  AstStatement,
} from "./ast.js";
import { assertSafePath, assertSafePathSegment, parseTemplate } from "./ast.js";
import { isControlHelperName, isKnownHelperName } from "./helpers.js";

export type PlaceholderNode = string | PlaceholderTree;

export type PlaceholderTree = {
  [key: string]: PlaceholderNode;
};

/**
 * Builds the JSON-safe data shape a template expects from its Handlebars AST.
 */
// ORCHID-MEM: 01a1c51f-4010-7adb-9a80-cc229f720c94 — Extracts the JSON placeholder tree from a Handlebars AST without prototype pollution.
export function extractPlaceholders(source: string): PlaceholderTree {
  return extractPlaceholdersFromProgram(parseTemplate(source), source);
}

export function extractPlaceholdersFromProgram(
  program: AstProgram,
  source?: string,
): PlaceholderTree {
  const tree = createPlaceholderTree();
  walkProgram(program, tree, source);
  return sortPlaceholders(tree);
}

export function createPlaceholderTree(): PlaceholderTree {
  return Object.create(null) as PlaceholderTree;
}

export function isPlaceholderTree(value: unknown): value is PlaceholderTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sortPlaceholders(tree: PlaceholderTree): PlaceholderTree {
  return sortTree(tree);
}

export function mergePlaceholders(target: PlaceholderTree, source: PlaceholderTree): void {
  for (const [key, value] of Object.entries(source)) {
    assertSafePathSegment(key, key);
    const existing = target[key];

    if (typeof value === "string") {
      target[key] = mergeNode(existing, value);
      continue;
    }

    if (isPlaceholderTree(existing)) {
      mergePlaceholders(existing, value);
      continue;
    }

    target[key] = value;
  }
}

function walkProgram(program: AstProgram, tree: PlaceholderTree, source: string | undefined): void {
  for (const statement of program.body) {
    walkStatement(statement, tree, source);
  }
}

function walkStatement(
  statement: AstStatement,
  tree: PlaceholderTree,
  source: string | undefined,
): void {
  switch (statement.type) {
    case "BlockStatement":
      walkBlockStatement(statement, tree, source);
      break;
    case "MustacheStatement":
      walkMustacheStatement(statement, tree);
      break;
    case "PartialStatement":
      walkPartialStatement(statement, tree);
      break;
    case "PartialBlockStatement":
      walkPartialBlockStatement(statement, tree, source);
      break;
    case "Decorator":
    case "DecoratorBlock":
      walkDecorator(statement, tree, source);
      break;
    case "ContentStatement":
    case "CommentStatement":
      break;
  }
}

function walkBlockStatement(
  statement: AstBlockStatement,
  tree: PlaceholderTree,
  source: string | undefined,
): void {
  if (statement.path.type === "PathExpression") {
    assertSafePath(statement.path);
  }

  const helperName = expressionName(statement.path);

  if (helperName !== undefined && isControlHelperName(helperName)) {
    switch (helperName) {
      case "each":
        addBlockPlaceholder(tree, statement.params, "array");
        break;
      case "if":
      case "unless":
        addBlockPlaceholder(tree, statement.params, "boolean");
        break;
      case "with":
        addBlockPlaceholder(tree, statement.params, "object");
        break;
    }

    walkHash(statement.hash, tree);

    // An each/with body sees a different context, so its leaf paths do not
    // describe the root data. The inverse block still renders with the parent.
    if (helperName === "each" || helperName === "with") {
      if (statement.inverse !== undefined) {
        walkProgram(statement.inverse, tree, source);
      }
      return;
    }

    if (statement.program !== undefined) {
      walkProgram(statement.program, tree, source);
    }
    if (statement.inverse !== undefined) {
      walkProgram(statement.inverse, tree, source);
    }
    return;
  }

  const isHelperCall =
    statement.params.length > 0 ||
    (statement.hash?.pairs.length ?? 0) > 0 ||
    (helperName !== undefined && isKnownHelperName(helperName));

  if (isHelperCall) {
    walkExpressions(statement.params, tree);
    walkHash(statement.hash, tree);
    if (statement.program !== undefined) {
      walkProgram(statement.program, tree, source);
    }
    if (statement.inverse !== undefined) {
      walkProgram(statement.inverse, tree, source);
    }
    return;
  }

  if (isInvertedSection(statement, source)) {
    addExpressionMarker(tree, statement.path, "boolean");
    // Both branches of an inverted boolean section render with the parent.
    if (statement.program !== undefined) {
      walkProgram(statement.program, tree, source);
    }
    if (statement.inverse !== undefined) {
      walkProgram(statement.inverse, tree, source);
    }
    return;
  }

  addExpressionMarker(tree, statement.path, "object");
  // A normal section changes context to its value, so only the inverse is root.
  if (statement.inverse !== undefined) {
    walkProgram(statement.inverse, tree, source);
  }
}

function walkMustacheStatement(
  statement: Extract<AstStatement, { type: "MustacheStatement" }>,
  tree: PlaceholderTree,
): void {
  if (statement.path.type === "PathExpression") {
    assertSafePath(statement.path);
  }

  const isHelperCall =
    statement.params.length > 0 ||
    (statement.hash?.pairs.length ?? 0) > 0 ||
    (statement.path.type === "PathExpression" && isKnownHelperName(statement.path.original));

  if (isHelperCall) {
    walkExpressions(statement.params, tree);
    walkHash(statement.hash, tree);
    return;
  }

  walkExpression(statement.path, tree);
}

function walkPartialStatement(statement: AstPartialStatement, tree: PlaceholderTree): void {
  walkPartialName(statement.name, tree);
  walkExpressions(statement.params, tree);
  walkHash(statement.hash, tree);
}

function walkPartialBlockStatement(
  statement: AstPartialBlockStatement,
  tree: PlaceholderTree,
  source: string | undefined,
): void {
  walkPartialName(statement.name, tree);
  walkExpressions(statement.params, tree);
  walkHash(statement.hash, tree);
  if (statement.program !== undefined) {
    walkProgram(statement.program, tree, source);
  }
}

function walkPartialName(name: AstExpression, tree: PlaceholderTree): void {
  if (name.type === "SubExpression") {
    walkExpression(name, tree);
  }
}

function walkDecorator(
  statement: Extract<AstStatement, { type: "Decorator" | "DecoratorBlock" }>,
  tree: PlaceholderTree,
  source: string | undefined,
): void {
  if (statement.params !== undefined) {
    walkExpressions(statement.params, tree);
  }
  if (statement.hash !== undefined) {
    walkHash(statement.hash, tree);
  }
  if (statement.program !== undefined) {
    walkProgram(statement.program, tree, source);
  }
}

function walkExpression(expression: AstExpression, tree: PlaceholderTree): void {
  if (expression.type === "PathExpression") {
    addValuePath(tree, expression);
    return;
  }

  if (expression.type === "SubExpression") {
    if (expression.path.type === "PathExpression") {
      assertSafePath(expression.path);
    }
    walkExpressions(expression.params, tree);
    walkHash(expression.hash, tree);
  }
}

function walkExpressions(expressions: readonly AstExpression[], tree: PlaceholderTree): void {
  for (const expression of expressions) {
    walkExpression(expression, tree);
  }
}

function walkHash(hash: AstHash | undefined, tree: PlaceholderTree): void {
  if (hash === undefined) {
    return;
  }

  for (const pair of hash.pairs) {
    assertSafePathSegment(pair.key, pair.key);
    walkExpression(pair.value, tree);
  }
}

function addBlockPlaceholder(
  tree: PlaceholderTree,
  params: readonly AstExpression[],
  marker: string,
): void {
  const [first, ...rest] = params;

  if (first === undefined) {
    return;
  }

  addExpressionMarker(tree, first, marker);
  walkExpressions(rest, tree);
}

function addExpressionMarker(
  tree: PlaceholderTree,
  expression: AstExpression,
  marker: string,
): void {
  if (expression.type === "PathExpression") {
    addPath(tree, expression, marker);
    return;
  }

  walkExpression(expression, tree);
}

function addValuePath(tree: PlaceholderTree, path: AstPathExpression): void {
  addPath(tree, path, "string");
}

function addPath(tree: PlaceholderTree, path: AstPathExpression, marker: string): void {
  const parts = readPathParts(path);
  if (parts === undefined) {
    return;
  }

  setPath(tree, parts, marker);
}

function readPathParts(path: AstPathExpression): readonly string[] | undefined {
  assertSafePath(path);

  let parts = path.parts.filter((part) => part.length > 0);

  if (path.data) {
    if (parts[0] !== "root") {
      return undefined;
    }
    parts = parts.slice(1);
  }

  return parts.length === 0 ? undefined : parts;
}

function setPath(tree: PlaceholderTree, parts: readonly string[], marker: string): void {
  let cursor = tree;

  for (const segment of parts.slice(0, -1)) {
    const existing = cursor[segment];

    if (isPlaceholderTree(existing)) {
      cursor = existing;
      continue;
    }

    const child = createPlaceholderTree();
    cursor[segment] = child;
    cursor = child;
  }

  const leaf = parts[parts.length - 1];
  if (leaf === undefined) {
    return;
  }

  cursor[leaf] = mergeNode(cursor[leaf], marker);
}

function mergeNode(existing: PlaceholderNode | undefined, marker: string): PlaceholderNode {
  if (isPlaceholderTree(existing)) {
    return existing;
  }

  if (existing !== undefined && existing !== "string" && marker === "string") {
    return existing;
  }

  return marker;
}

function expressionName(expression: AstExpression): string | undefined {
  return expression.type === "PathExpression" ? expression.original : undefined;
}

function isInvertedSection(statement: AstBlockStatement, source: string | undefined): boolean {
  if (statement.program === undefined) {
    return true;
  }

  if (source === undefined || statement.loc === undefined) {
    return false;
  }

  const offset = sourceOffset(source, statement.loc.start.line, statement.loc.start.column);
  return /^\{\{~?\s*\^/.test(source.slice(offset, offset + 8));
}

function sourceOffset(source: string, line: number, column: number): number {
  let offset = 0;

  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const nextLine = source.indexOf("\n", offset);
    if (nextLine === -1) {
      return source.length;
    }
    offset = nextLine + 1;
  }

  return offset + column;
}

function sortTree(tree: PlaceholderTree): PlaceholderTree {
  const sorted = createPlaceholderTree();

  for (const key of Object.keys(tree).sort(comparePaths)) {
    const value = tree[key];
    if (value === undefined) {
      continue;
    }

    sorted[key] = typeof value === "string" ? value : sortTree(value);
  }

  return sorted;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
