/**
 * A deliberately small YAML subset parser.
 *
 * orchid-sdd configuration and front matter use a constrained YAML subset:
 * block mappings, block sequences, inline lists/maps, quoted strings, booleans,
 * numbers, null, and comments. Block scalars (| and >) and anchors are not
 * supported and fail with a clear error.
 *
 * Keeping this dependency-free is what makes the CLI portable.
 */
export class YamlError extends Error {
  constructor(message) {
    super(message);
    this.name = "YamlError";
  }
}

const KEY_RE = /^[A-Za-z_][\w.-]*:(\s|$)/;
const INT_RE = /^[-+]?\d+$/;
const FLOAT_RE = /^[-+]?\d+\.\d+$/;

function stripComment(raw) {
  let out = "";
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      out += ch;
      if (quote === '"' && ch === "\\" && i + 1 < raw.length) {
        out += raw[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && raw[i + 1] === "'") {
          out += raw[i + 1];
          i += 1;
          continue;
        }
        quote = null;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "#") {
      break;
    } else {
      out += ch;
    }
  }
  return out.replace(/\s+$/, "");
}

function prepare(text) {
  const lines = [];
  const rawLines = String(text).split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const leading = (raw.match(/^[ \t]*/) || [""])[0];
    if (leading.includes("\t")) {
      throw new YamlError(`line ${i + 1}: tabs are not allowed for indentation`);
    }
    const stripped = stripComment(raw);
    const content = stripped.trim();
    if (!content || content === "---" || content === "...") continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ num: i + 1, indent, content });
  }
  return lines;
}

function splitTop(text, sep = ",") {
  const parts = [];
  let buf = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (quote === '"' && ch === "\\" && i + 1 < text.length) {
        buf += text[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
    } else if ("[{(".includes(ch)) {
      depth += 1;
      buf += ch;
    } else if ("]})".includes(ch)) {
      depth -= 1;
      buf += ch;
    } else if (ch === sep && depth === 0) {
      parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf.trim());
  return parts;
}

function unquote(text, num) {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const body = text.slice(1, -1);
    let out = "";
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === "\\" && i + 1 < body.length) {
        const next = body[i + 1];
        if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === '"') out += '"';
        else if (next === "\\") out += "\\";
        else out += next;
        i += 1;
      } else {
        out += ch;
      }
    }
    return out;
  }
  throw new YamlError(`line ${num}: unterminated quoted string`);
}

function splitKey(text, num) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ":") {
      let key = text.slice(0, i).trim();
      if (!key) throw new YamlError(`line ${num}: empty key`);
      if (key.startsWith("'") || key.startsWith('"')) key = unquote(key, num);
      return { key, value: text.slice(i + 1).trim() };
    }
  }
  throw new YamlError(`line ${num}: expected 'key: value'`);
}

function looksLikeMapItem(text) {
  if (text.startsWith("http://") || text.startsWith("https://")) return false;
  return KEY_RE.test(text);
}

function parseScalar(text, num) {
  const value = text.trim();
  if (!value) return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return splitTop(body).map((part) => parseScalar(part, num));
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const body = value.slice(1, -1).trim();
    const result = {};
    if (!body) return result;
    for (const part of splitTop(body)) {
      const { key, value: inner } = splitKey(part, num);
      result[key] = parseScalar(inner, num);
    }
    return result;
  }
  if (value.startsWith("'") || value.startsWith('"')) return unquote(value, num);
  const low = value.toLowerCase();
  if (["true", "yes", "on"].includes(low)) return true;
  if (["false", "no", "off"].includes(low)) return false;
  if (["null", "~"].includes(low)) return null;
  if (INT_RE.test(value)) return Number.parseInt(value, 10);
  if (FLOAT_RE.test(value)) return Number.parseFloat(value);
  if (value === "|" || value === ">") {
    throw new YamlError(
      `line ${num}: block scalars ('|' and '>') are not supported; use a quoted string`,
    );
  }
  return value;
}

function parseMap(lines, index, indent, first = null) {
  const result = {};
  let idx = index;
  let pending = first;
  for (;;) {
    let num;
    let text;
    if (pending) {
      num = pending.num;
      text = pending.text;
      pending = null;
    } else {
      if (idx >= lines.length || lines[idx].indent !== indent) break;
      if (lines[idx].content === "-" || lines[idx].content.startsWith("- ")) break;
      num = lines[idx].num;
      text = lines[idx].content;
      idx += 1;
    }
    const { key, value } = splitKey(text, num);
    if (value) {
      result[key] = parseScalar(value, num);
    } else if (idx < lines.length && lines[idx].indent > indent) {
      const nested = parseBlock(lines, idx, lines[idx].indent);
      result[key] = nested.value;
      idx = nested.index;
    } else {
      result[key] = null;
    }
  }
  return { value: result, index: idx };
}

function parseList(lines, index, indent) {
  const result = [];
  let idx = index;
  while (idx < lines.length && lines[idx].indent === indent) {
    const line = lines[idx];
    if (!(line.content === "-" || line.content.startsWith("- "))) break;
    const text = line.content.slice(1).trim();
    idx += 1;
    if (!text) {
      if (idx < lines.length && lines[idx].indent > indent) {
        const nested = parseBlock(lines, idx, lines[idx].indent);
        result.push(nested.value);
        idx = nested.index;
      } else {
        result.push(null);
      }
    } else if (looksLikeMapItem(text)) {
      const nested = parseMap(lines, idx, indent + 2, { num: line.num, text });
      result.push(nested.value);
      idx = nested.index;
    } else {
      result.push(parseScalar(text, line.num));
    }
  }
  return { value: result, index: idx };
}

function parseBlock(lines, index, indent) {
  if (lines[index].content === "-" || lines[index].content.startsWith("- ")) {
    return parseList(lines, index, indent);
  }
  return parseMap(lines, index, indent);
}

export function parseYaml(text) {
  const lines = prepare(text);
  if (!lines.length) return {};
  const parsed = parseBlock(lines, 0, lines[0].indent);
  if (parsed.index !== lines.length) {
    const line = lines[parsed.index];
    throw new YamlError(
      `line ${line.num}: unexpected indentation or content: ${JSON.stringify(line.content)}`,
    );
  }
  return parsed.value;
}

export function parseFrontMatter(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: text };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    throw new YamlError("unterminated front matter (missing closing '---')");
  }
  const block = normalized.slice(4, end);
  let body = normalized.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  const data = parseYaml(block);
  if (data === null) return { data: {}, body };
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new YamlError("front matter must be a mapping");
  }
  return { data, body };
}
