import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import {
  detectCurrentIdentity,
  evaluateRoute,
  resolveRoute,
} from "./models.mjs";
import {
  appendEvent,
  paths,
  readState,
  writeProjection,
  writeState,
} from "./store.mjs";
import { OrchidError, exists, formatJson, nowIso, uuid7 } from "./util.mjs";
import { parseFrontMatter } from "./yaml.mjs";
import { formatLedgerDiagnostic, readLedger } from "./dependencies.mjs";

const PROMPT_RE = /^P-[0-9]{3}$/;
const DEP_RE = /^DEP-[0-9]{3}$/;
const PROMPT_TYPES = ["build", "test", "spike"];
const ESTIMATE_VALUES = ["S", "M", "L"];
const EFFORT_VALUES = ["low", "medium", "high", "extra-high", "ultra"];
const REQUIRED_PROMPT_FIELDS = ["id", "type", "title", "wave", "personas", "scope", "acceptance"];
const STRING_ARRAY_FIELDS = ["depends_on", "personas", "acceptance", "memory_refs", "constitution_refs"];
export const PROMPT_ALLOWED_KEYS = new Set([
  "id", "type", "title", "repo", "wave", "depends_on", "personas", "scope",
  "deliverables", "acceptance", "memory_refs", "constitution_refs",
  "dependency_refs", "estimate", "effort", "timebox",
]);

function requireActive(state) {
  if (!state.activeIteration) {
    throw new OrchidError("no active iteration; run `orchid-sdd start` first");
  }
}

function updateMatrix(root, config, state, prompt, status, step) {
  const file = path.join(
    paths(root, config).iterations,
    state.activeIteration,
    "plan",
    "matrix.json",
  );
  if (!exists(file)) return;
  let matrix;
  try {
    matrix = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const list = Array.isArray(matrix) ? matrix : matrix.prompts;
  if (!Array.isArray(list)) return;
  const item = list.find((entry) => entry && entry.id === prompt);
  if (!item) return;
  item.status = status;
  if (step) item.step = step;
  item.updatedAt = nowIso();
  fs.writeFileSync(file, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
}

function promptRoute(root, config, state, prompt) {
  const route = resolveRoute(root, config, {
    phase: state.phase,
    prompt,
    iteration: state.activeIteration,
  });
  return evaluateRoute(route, detectCurrentIdentity());
}

function printRoute(routing) {
  process.stdout.write(
    `  routing:  ${routing.effort} (${routing.source}) → ${routing.expectedText || "unassigned"}\n`,
  );
  process.stdout.write(`  current:  ${routing.currentText}\n`);
  if (routing.message) {
    const label = routing.status === "unassigned" ? "[info]" : "[alert]";
    process.stdout.write(`  ${label.padEnd(9)}${routing.message}\n`);
  }
}

function promptState(state, id) {
  const prompt = state.prompts && state.prompts[id];
  if (!prompt) throw new OrchidError(`prompt ${id} has no recorded state`);
  return prompt;
}

function listPrompts(state) {
  return Object.values(state.prompts || {}).sort((a, b) => a.id.localeCompare(b.id));
}

function promptsDir(root, config, state) {
  return path.join(paths(root, config).iterations, state.activeIteration, "plan", "prompts");
}

function promptFile(root, config, state, id) {
  return path.join(promptsDir(root, config, state), `${id}.md`);
}

function readPromptContract(root, config, state, id) {
  const file = promptFile(root, config, state, id);
  if (!exists(file)) return null;
  try {
    const { data } = parseFrontMatter(fs.readFileSync(file, "utf8"));
    return data;
  } catch {
    return null;
  }
}

function validatePrompts(root, config, state) {
  const errors = [];
  const warnings = [];
  const dir = promptsDir(root, config, state);
  const ledger = readLedger(root, config);

  // An invalid ledger invalidates every reference: surface its diagnostics and
  // refuse to resolve any DEP-### from untrustworthy rows.
  for (const error of ledger.errors) {
    errors.push(`cross-repo-dependencies.md: ${formatLedgerDiagnostic(error)}`);
  }
  const depById = ledger.errors.length
    ? new Map()
    : new Map(ledger.rows.map((row) => [row.ID, row]));

  const files = [];
  if (exists(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push({ name: entry.name, file: path.join(dir, entry.name) });
      }
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  const parsed = [];
  for (const { name, file } of files) {
    try {
      const { data } = parseFrontMatter(fs.readFileSync(file, "utf8"));
      parsed.push({ name, data });
    } catch (error) {
      errors.push(`${name}: front matter: ${error.message}`);
    }
  }

  const ids = new Set();
  for (const { name, data } of parsed) {
    const id = data && data.id ? String(data.id) : null;
    if (id && ids.has(id)) errors.push(`${name}: id: duplicate prompt id "${id}"`);
    if (id) ids.add(id);
  }

  const present = (value) => value !== undefined && value !== null && value !== "";
  const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

  const prompts = [];
  for (const { name, data } of parsed) {
    const id = data && data.id ? String(data.id) : null;

    for (const key of Object.keys(data)) {
      if (!PROMPT_ALLOWED_KEYS.has(key)) {
        errors.push(`${name}: ${key}: unknown key`);
      }
    }

    for (const field of REQUIRED_PROMPT_FIELDS) {
      if (!present(data[field])) errors.push(`${name}: ${field}: required field is missing`);
    }
    if (id && !PROMPT_RE.test(id)) {
      errors.push(`${name}: id: invalid prompt id "${id}" (expected P-###)`);
    }
    if (id && PROMPT_RE.test(id) && name !== `${id}.md`) {
      errors.push(`${name}: id: filename must be "${id}.md" (got "${name}")`);
    }
    if (present(data.type) && !PROMPT_TYPES.includes(data.type)) {
      errors.push(`${name}: type: must be one of ${PROMPT_TYPES.join(", ")}`);
    }
    if (present(data.title) && typeof data.title !== "string") {
      errors.push(`${name}: title: must be a string`);
    }
    if (present(data.repo) && typeof data.repo !== "string") {
      errors.push(`${name}: repo: must be a string`);
    }
    if (present(data.wave) && (!Number.isInteger(data.wave) || data.wave < 1)) {
      errors.push(`${name}: wave: must be a positive integer`);
    }
    for (const field of STRING_ARRAY_FIELDS) {
      if (present(data[field]) && !isStringArray(data[field])) {
        errors.push(`${name}: ${field}: must be a list of strings`);
      }
    }
    if (
      present(data.scope) &&
      (!data.scope || typeof data.scope !== "object" || Array.isArray(data.scope) || !Array.isArray(data.scope.write))
    ) {
      errors.push(`${name}: scope: must be a mapping with a write list`);
    }
    if (
      present(data.scope) &&
      data.scope &&
      typeof data.scope === "object" &&
      !Array.isArray(data.scope)
    ) {
      if (Array.isArray(data.scope.write) && !isStringArray(data.scope.write)) {
        errors.push(`${name}: scope.write: must be a list of strings`);
      }
      if (present(data.scope.read) && !isStringArray(data.scope.read)) {
        errors.push(`${name}: scope.read: must be a list of strings`);
      }
    }
    if (present(data.deliverables) && (typeof data.deliverables !== "object" || Array.isArray(data.deliverables))) {
      errors.push(`${name}: deliverables: must be a mapping`);
    }
    if (present(data.estimate) && !ESTIMATE_VALUES.includes(data.estimate)) {
      errors.push(`${name}: estimate: must be one of ${ESTIMATE_VALUES.join(", ")}`);
    }
    if (present(data.effort) && !EFFORT_VALUES.includes(data.effort)) {
      errors.push(`${name}: effort: must be one of ${EFFORT_VALUES.join(", ")}`);
    }
    if (present(data.timebox) && typeof data.timebox !== "string") {
      errors.push(`${name}: timebox: must be a string`);
    }
    if (present(data.depends_on)) {
      if (!Array.isArray(data.depends_on)) {
        errors.push(`${name}: depends_on: must be a list`);
      } else {
        for (const dep of data.depends_on) {
          if (!ids.has(dep)) errors.push(`${name}: depends_on: unknown prompt "${dep}"`);
        }
      }
    }

    const refs = Array.isArray(data.dependency_refs) ? data.dependency_refs : [];
    const dependencies = [];
    const seenRefs = new Set();
    if (present(data.dependency_refs) && !Array.isArray(data.dependency_refs)) {
      errors.push(`${name}: dependency_refs: must be a list`);
    } else {
      for (const ref of refs) {
        if (!DEP_RE.test(String(ref))) {
          errors.push(`${name}: dependency_refs: invalid dependency id "${ref}" (expected DEP-###)`);
        } else if (seenRefs.has(ref)) {
          errors.push(`${name}: dependency_refs: duplicate dependency "${ref}"`);
        } else if (!depById.has(ref)) {
          errors.push(`${name}: dependency_refs: unknown dependency "${ref}"`);
        } else {
          seenRefs.add(ref);
          dependencies.push(depById.get(ref));
        }
      }
    }

    prompts.push({ id: id || null, file: name, dependency_refs: refs, dependencies });
  }

  return { prompts, errors, warnings };
}

export function promptCommand(root, args = {}) {
  const { config } = loadConfig(root);
  const state = readState(root);
  requireActive(state);
  const action = String(args.action || "list");
  const id = args.id ? String(args.id) : null;
  if (id && !PROMPT_RE.test(id)) {
    throw new OrchidError(`prompt id must look like P-001: ${id}`);
  }

  if (action === "list") {
    const rows = listPrompts(state);
    if (args.json) {
      process.stdout.write(`${formatJson(rows)}\n`);
      return 0;
    }
    if (!rows.length) {
      process.stdout.write("No prompt state recorded.\n");
      return 0;
    }
    for (const prompt of rows) {
      process.stdout.write(
        `${prompt.id}  ${prompt.status.padEnd(18)}  step=${prompt.step || "—"}  attempt=${prompt.attempt || 1}  run=${prompt.runId || "—"}\n`,
      );
    }
    return 0;
  }

  if (action === "show") {
    if (!id) throw new OrchidError("prompt show requires a prompt id");
    const prompt = promptState(state, id);
    const contract = readPromptContract(root, config, state, id);
    const dependencyRefs = contract && Array.isArray(contract.dependency_refs) ? contract.dependency_refs : null;
    if (args.json) {
      process.stdout.write(
        `${formatJson({
          ...prompt,
          routing: state.runs[prompt.runId]?.routing || null,
          dependency_refs: dependencyRefs,
        })}\n`,
      );
      return 0;
    }
    process.stdout.write(`${prompt.id}  ${prompt.status}\n`);
    process.stdout.write(`  step:    ${prompt.step || "—"}\n`);
    process.stdout.write(`  attempt: ${prompt.attempt || 1}\n`);
    process.stdout.write(`  run:     ${prompt.runId || "—"}\n`);
    if (dependencyRefs && dependencyRefs.length) {
      process.stdout.write(`  dependency_refs: ${dependencyRefs.join(", ")}\n`);
    }
    if (prompt.evidence) process.stdout.write(`  evidence: ${prompt.evidence}\n`);
    const run = state.runs[prompt.runId];
    if (run?.routing) printRoute(run.routing);
    return 0;
  }

  if (action === "validate") {
    const result = validatePrompts(root, config, state);
    if (args.json) {
      process.stdout.write(`${formatJson(result)}\n`);
      return result.errors.length ? 1 : 0;
    }
    process.stdout.write(`Prompt validation: ${result.prompts.length} prompt(s)\n`);
    for (const error of result.errors) process.stdout.write(`  [error] ${error}\n`);
    for (const warning of result.warnings) process.stdout.write(`  [warn]  ${warning}\n`);
    process.stdout.write(`\n${result.errors.length} error(s), ${result.warnings.length} warning(s)\n`);
    return result.errors.length ? 1 : 0;
  }

  if (!["start", "step", "complete", "fail", "waive"].includes(action)) {
    throw new OrchidError(`unknown prompt action "${action}"`);
  }
  if (!id) throw new OrchidError(`prompt ${action} requires a prompt id`);

  if (action === "start") {
    if (state.currentPrompt && state.currentPrompt !== id) {
      throw new OrchidError(
        `prompt ${state.currentPrompt} is still active; complete, fail, or waive it before starting ${id}`,
      );
    }
    const routing = promptRoute(root, config, state, id);
    if (config.models.mismatch === "block" && routing.status === "mismatch") {
      throw new OrchidError(routing.message);
    }
    const attempt = (state.prompts?.[id]?.attempt || 0) + 1;
    const runId = uuid7();
    const step = String(args.step || "implement");
    const prompt = {
      id,
      status: "running",
      step,
      attempt,
      runId,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.prompts[id] = prompt;
    state.runs[runId] = {
      id: runId,
      prompt: id,
      phase: state.phase,
      attempt,
      step,
      status: "running",
      startedAt: prompt.startedAt,
      routing,
    };
    state.currentPrompt = id;
    state.currentRun = runId;
    appendEvent(root, config, state, {
      type: "prompt.started",
      subject: `prompt:${id}`,
      payload: { prompt, run: state.runs[runId], routing },
    });
    writeProjection(root, config, state);
    updateMatrix(root, config, state, id, "running", step);
    if (args.json) {
      process.stdout.write(`${formatJson({ prompt, routing })}\n`);
      return 0;
    }
    process.stdout.write(`Prompt ${id} running\n`);
    process.stdout.write(`  step:    ${step}\n`);
    process.stdout.write(`  attempt: ${attempt}\n`);
    printRoute(routing);
    return 0;
  }

  const prompt = promptState(state, id);
  if (prompt.status !== "running") {
    throw new OrchidError(
      `prompt ${id} is ${prompt.status}; start a new attempt before ${action}`,
    );
  }
  if (action === "step") {
    const step = String(args.step || "").trim();
    if (!step) throw new OrchidError("prompt step requires --step NAME");
    prompt.step = step;
    prompt.updatedAt = nowIso();
    const run = state.runs[prompt.runId];
    if (run) {
      run.step = step;
      run.updatedAt = prompt.updatedAt;
    }
    appendEvent(root, config, state, {
      type: "prompt.step",
      subject: `prompt:${id}`,
      payload: { prompt: id, step, run: prompt.runId },
    });
    writeProjection(root, config, state);
    updateMatrix(root, config, state, id, prompt.status, step);
    if (args.json) {
      process.stdout.write(`${formatJson(prompt)}\n`);
      return 0;
    }
    process.stdout.write(`Prompt ${id} step: ${step}\n`);
    return 0;
  }

  const status = action === "complete" ? "done" : action === "fail" ? "failed" : "waived";
  prompt.status = status;
  prompt.updatedAt = nowIso();
  if (args.note) prompt.note = String(args.note);
  if (args.evidence) prompt.evidence = String(args.evidence);
  const run = state.runs[prompt.runId];
  if (run) {
    run.status = status === "done" ? "completed" : status;
    run.completedAt = prompt.updatedAt;
    run.note = args.note || null;
  }
  if (state.currentPrompt === id) {
    state.currentPrompt = null;
    state.currentRun = null;
  }
  appendEvent(root, config, state, {
    type: action === "complete" ? "prompt.completed" : action === "fail" ? "prompt.failed" : "prompt.waived",
    subject: `prompt:${id}`,
    payload: {
      prompt: id,
      status,
      note: args.note || null,
      evidence: args.evidence || null,
      run: prompt.runId,
    },
  });
  writeProjection(root, config, state);
  updateMatrix(root, config, state, id, status, prompt.step);
  if (args.json) {
    process.stdout.write(`${formatJson(prompt)}\n`);
    return 0;
  }
  process.stdout.write(`Prompt ${id} ${status}\n`);
  return 0;
}
