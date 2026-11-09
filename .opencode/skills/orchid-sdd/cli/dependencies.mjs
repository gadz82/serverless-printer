import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { OrchidError, exists, formatJson, nowIso } from "./util.mjs";

// The ledger is the single source of truth for cross-repo edges. This module only
// reads and validates it; it never writes the ledger itself. The generated index
// under .knowledge/index/ is derived from the ledger and must never be edited by hand.

export const LEDGER_FILE = ".orchid/cross-repo-dependencies.md";
export const INDEX_REL = "index/cross-repo-dependencies.json";

export const REQUIRED_COLUMNS = [
  "ID",
  "Kind",
  "Consumer",
  "Provider",
  "Contract",
  "Version",
  "Failure mode",
  "Rollout",
  "Consumer evidence",
  "Provider evidence",
  "Owner",
  "Status",
  "Last verified",
  "Related",
];

export const KINDS = ["api", "event", "package", "schema", "runtime", "data"];
export const STATUSES = ["open", "verified", "waived", "closed"];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const DEP_ID_RE = /^DEP-\d{3}$/;
const ADR_RE = /^ADR-\d+$/i;

function cleanCell(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .replace(/^`+/, "")
    .replace(/`+$/, "")
    .trim();
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  let inner = trimmed.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/**
 * Parse the ledger table. Returns header metadata, raw data rows (with line
 * numbers), and header-level diagnostics. Row-level validation that depends on
 * workspace config happens in readLedger.
 */
export function parseLedger(text) {
  const errors = [];
  const warnings = [];
  const lines = String(text || "").split("\n");
  let headers = null;
  let headerLine = 0;
  const rawRows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue; // ignore blank lines
    const cells = splitRow(raw);
    if (!cells) {
      if (headers) break; // table ended
      continue;
    }
    if (!headers) {
      if (isSeparatorRow(cells)) continue;
      headers = cells.map(cleanCell);
      headerLine = i + 1;
      continue;
    }
    if (isSeparatorRow(cells)) continue; // ignore separator row
    rawRows.push({ cells, line: i + 1 });
  }

  if (!headers) {
    warnings.push({ line: null, message: "no dependency table found" });
    return { headers: [], headerLine: 0, rawRows: [], errors, warnings };
  }

  const required = new Set(REQUIRED_COLUMNS);
  const seen = new Set();
  for (const column of headers) {
    if (seen.has(column)) {
      errors.push({ line: headerLine, message: `duplicate column "${column}"` });
    }
    seen.add(column);
    if (!required.has(column)) {
      warnings.push({ line: headerLine, message: `ignoring extra column "${column}"` });
    }
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) {
      errors.push({ line: headerLine, message: `missing required column "${column}"` });
    }
  }

  return { headers, headerLine, rawRows, errors, warnings };
}

function validateRow(cells, headers, line, enabledRepoIds) {
  const errors = [];
  const warnings = [];

  const row = {};
  headers.forEach((column, index) => {
    row[column] = cleanCell(cells[index]);
  });

  const id = row.ID || "";
  if (!DEP_ID_RE.test(id)) {
    errors.push({ line, message: `invalid ID "${id}" (expected DEP-###)` });
  }

  const kind = (row.Kind || "").toLowerCase();
  if (!KINDS.includes(kind)) {
    errors.push({
      line,
      message: `invalid Kind "${row.Kind || ""}" (expected one of: ${KINDS.join(", ")})`,
    });
  }

  for (const field of ["Consumer", "Provider"]) {
    const value = (row[field] || "").trim();
    const slash = value.indexOf("/");
    const repoId = slash >= 0 ? value.slice(0, slash).trim() : "";
    if (!repoId || !value.includes("/")) {
      errors.push({
        line,
        message: `${field} must start with an enabled workspace repo id followed by "/" (got "${value || "empty"}")`,
      });
    } else if (!enabledRepoIds.has(repoId)) {
      errors.push({
        line,
        message: `${field} uses unknown or disabled workspace repo id "${repoId}"`,
      });
    }
  }

  for (const field of ["Contract", "Version", "Failure mode", "Rollout", "Owner"]) {
    if (!(row[field] || "").trim()) {
      errors.push({ line, message: `${field} is required` });
    }
  }

  const status = (row.Status || "").toLowerCase();
  if (!STATUSES.includes(status)) {
    errors.push({
      line,
      message: `invalid Status "${row.Status || ""}" (expected one of: ${STATUSES.join(", ")})`,
    });
  } else if (status === "verified") {
    if (!(row["Consumer evidence"] || "").trim()) {
      errors.push({ line, message: "Consumer evidence is required for verified status" });
    }
    if (!(row["Provider evidence"] || "").trim()) {
      errors.push({ line, message: "Provider evidence is required for verified status" });
    }
    const verified = (row["Last verified"] || "").trim();
    if (!ISO_DATE_RE.test(verified) && !SHA_RE.test(verified)) {
      errors.push({
        line,
        message: `Last verified is required for verified status and must be an ISO date or 7-40 char hex SHA (got "${verified || "empty"}")`,
      });
    }
  } else if (status === "waived") {
    const related = (row.Related || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!related.some((item) => ADR_RE.test(item))) {
      errors.push({
        line,
        message: `waived status requires an ADR-### in Related (got "${row.Related || "empty"}")`,
      });
    }
  }

  // Normalized output preserves header order but drops extra columns.
  const normalized = {};
  const required = new Set(REQUIRED_COLUMNS);
  headers.forEach((column) => {
    if (required.has(column)) normalized[column] = row[column];
  });

  return { row: normalized, errors, warnings };
}

/**
 * Read and validate the ledger. Returns normalized rows plus line-numbered
 * errors and warnings. A missing ledger is treated as empty; a disabled
 * workspace skips validation entirely.
 */
export function readLedger(root, config) {
  const workspaceEnabled = Boolean(config && config.workspace && config.workspace.enabled);
  if (!workspaceEnabled) {
    return { present: false, workspaceEnabled: false, rows: [], errors: [], warnings: [] };
  }
  const file = path.join(root, LEDGER_FILE);
  if (!exists(file)) {
    return { present: false, workspaceEnabled: true, file, rows: [], errors: [], warnings: [] };
  }

  const parsed = parseLedger(fs.readFileSync(file, "utf8"));
  const enabledRepoIds = new Set(
    ((config.workspace && config.workspace.repos) || [])
      .filter((repo) => repo.enabled !== false)
      .map((repo) => repo.id),
  );

  const rows = [];
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const seenIds = new Set();

  for (const raw of parsed.rawRows) {
    const { row, errors: rowErrors, warnings: rowWarnings } = validateRow(
      raw.cells,
      parsed.headers,
      raw.line,
      enabledRepoIds,
    );
    errors.push(...rowErrors);
    warnings.push(...rowWarnings);
    if (row.ID) {
      if (seenIds.has(row.ID)) {
        errors.push({ line: raw.line, message: `duplicate ID "${row.ID}"` });
      }
      seenIds.add(row.ID);
    }
    rows.push(row);
  }

  return { present: true, workspaceEnabled: true, file, rows, errors, warnings };
}

/** Format every ledger error as an indented, line-numbered diagnostic line. */
export function formatLedgerErrors(ledger) {
  return (ledger.errors || [])
    .map((error) => `  ${formatLedgerDiagnostic(error)}`)
    .join("\n");
}

/**
 * The generated index value written to .knowledge/index/cross-repo-dependencies.json.
 * An invalid ledger never reaches the projection: every command that writes the
 * manifest or indexes fails before writing a partial cross-repo index.
 */
export function ledgerIndex(root, config) {
  const ledger = readLedger(root, config);
  if (ledger.errors.length) {
    throw new OrchidError(
      `invalid cross-repo dependency ledger (${LEDGER_FILE}):\n${formatLedgerErrors(ledger)}`,
    );
  }
  return { generatedAt: nowIso(), source: LEDGER_FILE, rows: ledger.rows };
}

/** Split a ledger `Related` cell into its comma-separated reference IDs. */
export function parseRelatedIds(related) {
  return String(related || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Format a line-numbered diagnostic for human output. */
export function formatLedgerDiagnostic(diag) {
  if (!diag) return "";
  return diag.line ? `line ${diag.line}: ${diag.message}` : diag.message;
}

function formatRow(row) {
  return [row.ID, row.Status, row.Kind, `${row.Consumer} -> ${row.Provider}`]
    .map((value) => value || "-")
    .join("  ");
}

function filterRows(rows, options) {
  return rows.filter((row) => {
    if (options.repo) {
      const repo = String(options.repo);
      const consumer = (row.Consumer || "").split("/")[0].trim();
      const provider = (row.Provider || "").split("/")[0].trim();
      if (consumer !== repo && provider !== repo) return false;
    }
    if (options.status && (row.Status || "").toLowerCase() !== String(options.status).toLowerCase()) {
      return false;
    }
    if (options.kind && (row.Kind || "").toLowerCase() !== String(options.kind).toLowerCase()) {
      return false;
    }
    return true;
  });
}

function reportList(ledger, options) {
  const errors = ledger.errors;
  const warnings = ledger.warnings;
  const rows = errors.length ? [] : filterRows(ledger.rows, options);
  if (options.json) {
    process.stdout.write(
      `${formatJson({ ok: errors.length === 0, rows, errors, warnings })}\n`,
    );
    return errors.length ? 1 : 0;
  }
  if (errors.length) {
    for (const error of errors) {
      process.stdout.write(`  [error] ${formatLedgerDiagnostic(error)}\n`);
    }
    for (const warning of warnings) {
      process.stdout.write(`  [warn]  ${formatLedgerDiagnostic(warning)}\n`);
    }
    process.stdout.write(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
    return 1;
  }
  if (!rows.length) {
    process.stdout.write("No dependencies.\n");
    return 0;
  }
  for (const row of rows) process.stdout.write(`${formatRow(row)}\n`);
  return 0;
}

function reportCheck(ledger, options) {
  const errors = ledger.errors;
  const warnings = ledger.warnings;
  const rows = errors.length ? [] : ledger.rows;
  if (options.json) {
    process.stdout.write(
      `${formatJson({ ok: errors.length === 0, rows, errors, warnings })}\n`,
    );
    return errors.length ? 1 : 0;
  }
  process.stdout.write(`Dependencies: ${ledger.rows.length} row(s)\n`);
  for (const error of errors) {
    process.stdout.write(`  [error] ${formatLedgerDiagnostic(error)}\n`);
  }
  for (const warning of warnings) {
    process.stdout.write(`  [warn]  ${formatLedgerDiagnostic(warning)}\n`);
  }
  process.stdout.write(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
  return errors.length ? 1 : 0;
}

/**
 * `orchid-sdd dependencies list|check`. In workspace mode the ledger is read and
 * validated; outside workspace mode it is a no-op (empty, no errors).
 */
export function dependenciesCommand(root, options = {}) {
  const action = options.action || "list";
  const loaded = loadConfig(root, { required: false });
  const ledger = loaded
    ? readLedger(root, loaded.config)
    : { present: false, workspaceEnabled: false, rows: [], errors: [], warnings: [] };

  if (action === "list") return reportList(ledger, options);
  if (action === "check") return reportCheck(ledger, options);
  throw new OrchidError(`unknown dependencies action "${action}" (expected list or check)`);
}
