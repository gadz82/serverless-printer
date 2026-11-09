import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PHASE_NAMES, loadConfig } from "./config.mjs";
import {
  appendEvent,
  archiveTransients,
  isMemoryEventType,
  listIterations,
  paths,
  readEvents,
  readState,
  writeIterationSnapshot,
  writeProjection,
  writeState,
} from "./store.mjs";
import {
  OrchidError,
  SCHEMA_VERSION,
  ensureDir,
  exists,
  formatJson,
  rel,
  slugify,
  today,
} from "./util.mjs";
import { assertClean, captureWorkspaceState, workspaceStatus } from "./workspace.mjs";
import { expandDirs } from "./registry.mjs";
import {
  activeSteering,
  loadSteering,
  steeringArtifact,
  validateSteeringRefs,
} from "./steering.mjs";
import { detectCurrentIdentity, evaluateRoute, resolveRoute } from "./models.mjs";
import { acceptHandoff, findHandoff } from "./handoff.mjs";

function context(root) {
  const loaded = loadConfig(root);
  const state = readState(root);
  return { config: loaded.config, state };
}

function requireActive(state) {
  if (!state.activeIteration) throw new OrchidError("no active iteration; run `orchid-sdd start` first");
}

function steeringFor(root, config, phase, skillRoot) {
  if (!skillRoot) return { map: null, rules: [] };
  const map = loadSteering(skillRoot, root, config);
  const errors = validateSteeringRefs(config, map);
  if (errors.length) {
    throw new OrchidError(`invalid steering configuration:\n - ${errors.join("\n - ")}`);
  }
  return { map, rules: activeSteering(config, map, phase) };
}

function routingFor(root, config, state, phase, prompt = null) {
  const route = resolveRoute(root, config, {
    phase,
    prompt,
    iteration: state && state.activeIteration,
  });
  return evaluateRoute(route, detectCurrentIdentity());
}

function printRouting(routing) {
  process.stdout.write(
    `  routing:  ${routing.effort} (${routing.source}) → ${routing.expectedText || "unassigned"}\n`,
  );
  process.stdout.write(`  current:  ${routing.currentText}\n`);
  if (routing.status === "unknown" || routing.status === "mismatch") {
    process.stdout.write(`  [alert]  ${routing.message}\n`);
  }
}

function validateTitle(raw, maxChars) {
  const title = String(raw || "").trim();
  if (!title) throw new OrchidError("a title is required");
  if (title.length > maxChars) {
    throw new OrchidError(`title is ${title.length} characters; maximum is ${maxChars}`);
  }
  if (title.length < 12) {
    throw new OrchidError("title is too vague: it must name the subject, the change, and the intended outcome");
  }
  const words = title.split(/\s+/);
  if (words.length <= 3 && /^(fix|update|improve|refactor|cleanup|change|add)\b/i.test(title)) {
    throw new OrchidError("title is too vague: state what changes and for whom");
  }
  return title;
}

function nextAction(phase) {
  const actions = {
    intent: "Ask whether to create a feature branch and which base (main/develop); write intent/prd.md and intent/trd.md, then `orchid-sdd gate pass G1 --evidence intent/prd.md`.",
    discovery: "Apply steering, capture discovery/Gherkin/questionnaires, write discovery/steering.md; then `orchid-sdd gate pass G2 --evidence discovery/gherkin`.",
    assessment: "Run the impact lenses and negotiation; then `orchid-sdd gate pass G3 --evidence assessment/negotiation.md`.",
    planning: "Generate the prompt DAG and cost estimate; then `orchid-sdd gate pass G4 --evidence plan/plan.json`.",
    build: "Execute ready prompts with `orchid-sdd build --all`; then `orchid-sdd gate pass G5 --note \"all prompts reviewed\"`.",
    logic_review: "Verify scenarios and steering, write reviews/logic-review.md and reviews/steering-review.md; ask the human \"Approve the changes and move forward.\" Then `orchid-sdd gate pass G6 --evidence reviews/logic-review.md`.",
    closed: "Ask \"Do you want to start the technical handover?\" If yes, run `orchid-sdd handover`, then `orchid-sdd handover --approve`.",
    handover: "Iteration complete.",
    abandoned: "Start a new iteration with `orchid-sdd start`.",
    setup: "Run `orchid-sdd setup`.",
    ready: "Run `orchid-sdd start \"<title>\"`.",
    complete: "Iteration complete.",
  };
  return actions[phase] || "Run `orchid-sdd status`.";
}

export function start(root, args) {
  const { config, state } = context(root);
  if (state.activeIteration) {
    throw new OrchidError(`iteration "${state.activeIteration}" is already active; close or abandon it first`);
  }
  assertClean(root, config, { allowDirty: Boolean(args.allowDirty) });
  const title = validateTitle(args.title, Number(config.governance.title_max_chars) || 500);
  const base = `${today()}-${slugify(title)}`;
  const existing = new Set(listIterations(root, config));
  let iteration = base;
  let suffix = 2;
  while (existing.has(iteration)) iteration = `${base}-${suffix++}`;
  const dir = path.join(paths(root, config).iterations, iteration);
  for (const sub of [
    "intent",
    "discovery/questions",
    "discovery/answers",
    "discovery/gherkin",
    "assessment/adr",
    "assessment/spikes",
    "plan/prompts/_bus/outbox",
    "plan/prompts/_bus/consumed",
    "execution/runs",
    "reviews",
    "audit",
    "handover",
  ]) {
    ensureDir(path.join(dir, sub));
  }

  const technicalOnly = Boolean(args.technicalOnly);
  if (args.rigor && !["S", "M", "L"].includes(args.rigor)) {
    throw new OrchidError("--rigor must be S, M, or L");
  }
  const configuredRigor = { light: "S", standard: "M", full: "L" }[config.governance.rigor] || "M";
  const rigor = args.rigor || configuredRigor;
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  fs.writeFileSync(
    path.join(dir, "intent", "title.md"),
    `# ${title}\n\n- Raw title: ${title}\n- Normalized: ${title}\n- Characters: ${title.length}/${config.governance.title_max_chars}\n- Technical only: ${technicalOnly ? "yes" : "no"}\n- Rigor: ${rigor} (proposed)\n- Started: ${timestamp}\n\n${technicalOnly ? "This is a purely technical change; the PRD is a change statement with a rationale.\n" : ""}`,
    "utf8",
  );

  state.activeIteration = iteration;
  state.iterationTitle = title;
  state.iterationRigor = rigor;
  state.phase = "intent";
  state.gates = Object.fromEntries(
    Object.keys(state.gates).map((gate) => [gate, gate === "G0" ? state.gates.G0 || "passed" : "pending"]),
  );
  writeState(root, state);
  appendEvent(root, config, state, {
    type: "iteration.started",
    subject: `urn:orchid:iteration:${iteration}`,
    payload: { id: iteration, title, rigor, technicalOnly, startedAt: timestamp },
  });
  writeProjection(root, config, state);

  if (args.json) {
    process.stdout.write(`${formatJson({ id: iteration, title, rigor, phase: "intent" })}\n`);
    return 0;
  }
  process.stdout.write(`Started ${iteration}\n`);
  process.stdout.write(`  ${title}\n`);
  process.stdout.write(`  ${nextAction("intent")}\n`);
  return 0;
}

export function gate(root, args) {
  const { config, state } = context(root);
  requireActive(state);
  const action = String(args.action || "status").toLowerCase();
  const steering = steeringFor(root, config, state.phase, args.skillRoot);
  if (action === "status") {
    const rows = Object.entries(state.gates).map(([name, status]) => `  ${name}  ${status}`);
    process.stdout.write(`Gates for ${state.activeIteration}\n${rows.join("\n")}\n`);
    return 0;
  }
  const name = String(args.gate || "").toUpperCase();
  if (!/^G[0-8]$/.test(name)) throw new OrchidError("gate must be one of G0..G8");
  if (!["pass", "fail"].includes(action)) throw new OrchidError("gate action must be pass, fail, or status");
  const evidence = args.evidence ? String(args.evidence) : null;
  if (!evidence && !args.note) {
    throw new OrchidError("gate pass/fail requires --evidence <path> or --note \"...\"");
  }
  let evidenceRel = null;
  if (evidence) {
    const absolute = path.isAbsolute(evidence)
      ? evidence
      : path.join(paths(root, config).iterations, state.activeIteration, evidence);
    if (!fs.existsSync(absolute)) throw new OrchidError(`evidence not found: ${absolute}`);
    evidenceRel = path.relative(root, absolute).split(path.sep).join("/");
  }
  state.gates[name] = action === "pass" ? "passed" : "failed";
  writeState(root, state);
  appendEvent(root, config, state, {
    type: action === "pass" ? "gate.passed" : "gate.failed",
    subject: `gate:${name}`,
    payload: {
      gate: name,
      evidence: evidenceRel,
      note: args.note || null,
      steering: steering.rules.map((rule) => rule.id),
      steeringArtifact: steering.rules.length ? steeringArtifact(state.phase) : null,
    },
  });
  writeProjection(root, config, state);
  process.stdout.write(`Gate ${name} ${state.gates[name]}\n`);
  return 0;
}

const PHASES = {
  discover: { target: "discovery", gate: "G1" },
  assess: { target: "assessment", gate: "G2" },
  plan: { target: "planning", gate: "G3" },
  build: { target: "build", gate: "G4" },
  review: { target: "logic_review", gate: "G5" },
};

export function phaseCommand(root, args, name) {
  const { config, state } = context(root);
  requireActive(state);
  const spec = PHASES[name];
  if (!spec) throw new OrchidError(`unknown phase command: ${name}`);
  if (state.gates[spec.gate] !== "passed") {
    throw new OrchidError(`gate ${spec.gate} must be passed before ${name}; run \`orchid-sdd gate pass ${spec.gate} --evidence <path>\``);
  }
  const iteration = path.join(paths(root, config).iterations, state.activeIteration);

  if (name === "assess" && !args.force) {
    const gherkin = path.join(iteration, "discovery", "gherkin");
    const files = exists(gherkin) ? fs.readdirSync(gherkin).filter((file) => file.endsWith(".feature")) : [];
    if (!files.length) throw new OrchidError("no Gherkin scenarios found; run discovery first or pass --force");
  }

  if (name === "review" && !args.force) {
    const matrixFile = path.join(iteration, "plan", "matrix.json");
    if (exists(matrixFile)) {
      try {
        const matrix = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
        const prompts = Array.isArray(matrix) ? matrix : matrix.prompts || [];
        const open = prompts.filter((prompt) => !["done", "waived"].includes(prompt.status));
        if (open.length) {
          throw new OrchidError(`prompts are not done: ${open.map((prompt) => `${prompt.id}:${prompt.status}`).join(", ")}; pass --force to review anyway`);
        }
      } catch (error) {
        if (error instanceof OrchidError) throw error;
        throw new OrchidError(`cannot read plan/matrix.json: ${error.message}`);
      }
    }
  }

  if (name === "handover" && !args.force) {
    for (const file of ["HANDOVER.md", "tour.md"]) {
      if (!exists(path.join(iteration, "handover", file))) {
        throw new OrchidError(`handover/${file} is missing; generate it first or pass --force`);
      }
    }
  }

  state.phase = spec.target;
  const steering = steeringFor(root, config, spec.target, args.skillRoot);
  const routing = routingFor(root, config, state, spec.target);
  writeState(root, state);
  appendEvent(root, config, state, {
    type: "phase.changed",
    subject: `phase:${spec.target}`,
    payload: {
      phase: spec.target,
      steering: steering.rules.map((rule) => rule.id),
      routing: {
        effort: routing.effort,
        expected: routing.expected,
        current: routing.current,
        status: routing.status,
      },
    },
  });
  writeProjection(root, config, state);

  if (args.json) {
    process.stdout.write(
      `${formatJson({
        phase: spec.target,
        iteration: state.activeIteration,
        steering: steering.rules.map((rule) => rule.id),
        steeringArtifact: steeringArtifact(spec.target),
        routing: {
          effort: routing.effort,
          expected: routing.expected,
          current: routing.current,
          status: routing.status,
          message: routing.message,
        },
      })}\n`,
    );
    return 0;
  }
  process.stdout.write(`Phase: ${spec.target}\n`);
  if (steering.rules.length) {
    process.stdout.write(
      `Steering ${spec.target} (${steering.rules.length}): ${steering.rules
        .map((rule) => `${rule.id}[${rule.authority}]`)
        .join(", ")}\n`,
    );
    process.stdout.write(`  artifact: ${steeringArtifact(spec.target)}\n`);
    process.stdout.write(
      `  Run \`orchid-sdd steering context --phase ${spec.target}\` and cite each rule ID in the phase artifact.\n`,
    );
  }
  printRouting(routing);
  process.stdout.write(`  ${nextAction(spec.target)}\n`);
  return 0;
}

function assertPromptsDone(iteration, force) {
  const matrixFile = path.join(iteration, "plan", "matrix.json");
  if (!exists(matrixFile)) return;
  const matrix = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
  const prompts = Array.isArray(matrix) ? matrix : matrix.prompts || [];
  const open = prompts.filter((prompt) => !["done", "waived"].includes(prompt.status));
  if (open.length && !force) {
    throw new OrchidError(
      `prompts are not done: ${open.map((prompt) => `${prompt.id}:${prompt.status}`).join(", ")}; pass --force to close anyway`,
    );
  }
}

export function close(root, args) {
  const { config, state } = context(root);
  requireActive(state);
  if (state.gates.G6 !== "passed") {
    throw new OrchidError("gate G6 (logic review) must be passed before closure");
  }
  if (!args.approve) {
    throw new OrchidError("closure requires human approval: rerun with --approve");
  }
  const iteration = path.join(paths(root, config).iterations, state.activeIteration);
  assertPromptsDone(iteration, Boolean(args.force));
  const id = state.activeIteration;
  state.gates.G7 = "passed";
  state.phase = "closed";
  writeState(root, state);
  const moved = archiveTransients(root, config, state);
  const workspace = captureWorkspaceState(root, config);
  writeIterationSnapshot(root, config, state, "closed", null, workspace);
  appendEvent(root, config, state, {
    type: "iteration.closed",
    subject: `urn:orchid:iteration:${id}`,
    payload: { id, status: "closed", closedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
  });
  state.activeIteration = null;
  state.lastIteration = id;
  writeState(root, state);
  writeProjection(root, config, state);
  if (args.json) {
    process.stdout.write(`${formatJson({ closed: id, archived: moved })}\n`);
    return 0;
  }
  process.stdout.write(`Closed ${id}\n`);
  process.stdout.write(`  archived: ${moved.length ? moved.join(", ") : "nothing"}\n`);
  process.stdout.write(`  ${nextAction("closed")}\n`);
  return 0;
}

export function abandon(root, args) {
  const { config, state } = context(root);
  requireActive(state);
  const reason = String(args.reason || "").trim();
  if (!reason) throw new OrchidError("abandon requires a reason: orchid-sdd abandon \"<reason>\"");
  const id = state.activeIteration;
  const moved = archiveTransients(root, config, state);
  const workspace = captureWorkspaceState(root, config);
  writeIterationSnapshot(root, config, state, "abandoned", reason, workspace);
  appendEvent(root, config, state, {
    type: "iteration.abandoned",
    subject: `urn:orchid:iteration:${id}`,
    payload: { id, status: "abandoned", reason, closedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
  });
  state.activeIteration = null;
  state.lastIteration = id;
  state.phase = "abandoned";
  writeState(root, state);
  writeProjection(root, config, state);
  if (args.json) {
    process.stdout.write(`${formatJson({ abandoned: id, reason, archived: moved })}\n`);
    return 0;
  }
  process.stdout.write(`Abandoned ${id}\n  reason: ${reason}\n`);
  process.stdout.write(`  archived: ${moved.length ? moved.join(", ") : "nothing"}\n`);
  return 0;
}

export function handover(root, args) {
  const { config, state } = context(root);
  if (state.activeIteration) {
    throw new OrchidError("close the iteration before handover");
  }
  if (!["closed", "complete", "handover"].includes(state.phase)) {
    throw new OrchidError("handover requires a closed iteration");
  }
  const id = state.lastIteration;
  if (!id) throw new OrchidError("no iteration to hand over");
  const iteration = path.join(paths(root, config).iterations, id);
  for (const file of ["HANDOVER.md", "tour.md"]) {
    if (!exists(path.join(iteration, "handover", file)) && !args.force) {
      throw new OrchidError(`handover/${file} is missing; generate it first or pass --force`);
    }
  }
  if (!args.approve) {
    state.activeIteration = id;
    state.phase = "handover";
    writeState(root, state);
    appendEvent(root, config, state, {
      type: "phase.changed",
      subject: `phase:handover`,
      payload: { phase: "handover", iteration: id },
    });
    state.activeIteration = null;
    state.lastIteration = id;
    writeState(root, state);
    process.stdout.write(`Handover for ${id} is ready for review.\n`);
    process.stdout.write("  Review handover/HANDOVER.md and handover/tour.md, then rerun with --approve.\n");
    return 0;
  }
  state.activeIteration = id;
  state.gates.G8 = "passed";
  state.phase = "complete";
  writeState(root, state);
  appendEvent(root, config, state, {
    type: "handover.accepted",
    subject: `urn:orchid:iteration:${id}`,
    payload: { id, approvedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
  });
  state.activeIteration = null;
  state.lastIteration = id;
  state.phase = "complete";
  writeState(root, state);
  writeProjection(root, config, state);
  if (args.json) {
    process.stdout.write(`${formatJson({ handover: id, status: "complete" })}\n`);
    return 0;
  }
  process.stdout.write(`Handover accepted for ${id}; iteration complete.\n`);
  return 0;
}

export function resume(root, args) {
  const { config, state } = context(root);
  const events = readEvents(root, config);
  if (!events.length) {
    process.stdout.write("No events to replay; state left unchanged.\n");
    return 0;
  }
  let active = null;
  let phase = "setup";
  let title = null;
  let lastClosed = null;
  let last = null;
  let lastMemory = null;
  let prompts = {};
  let runs = {};
  let currentPrompt = null;
  let currentRun = null;
  let lastHandoff = null;
  const acceptedHandoffs = new Set();
  const gates = Object.fromEntries(Object.keys(state.gates).map((gate) => [gate, "pending"]));

  for (const event of events) {
    last = event;
    if (isMemoryEventType(event.type)) lastMemory = event.eventId;
    const payload = event.payload || {};
    if (event.type === "iteration.started") {
      active = payload.id;
      phase = "intent";
      title = payload.title || null;
      prompts = {};
      runs = {};
      currentPrompt = null;
      currentRun = null;
      lastHandoff = null;
      for (const gate of Object.keys(gates)) gates[gate] = "pending";
      gates.G0 = "passed";
    } else if (event.type === "iteration.closed" || event.type === "iteration.abandoned") {
      if (active === payload.id) active = null;
      lastClosed = payload.id || lastClosed;
      phase = payload.status || "closed";
    } else if (event.type === "phase.changed" && payload.phase) {
      phase = payload.phase;
    } else if (event.type === "handover.accepted") {
      phase = "complete";
      gates.G8 = "passed";
    } else if (event.type === "gate.passed" && payload.gate) {
      gates[payload.gate] = "passed";
    } else if (event.type === "gate.failed" && payload.gate) {
      gates[payload.gate] = "failed";
    } else if (event.type === "prompt.started" && payload.prompt && payload.run) {
      prompts[payload.prompt.id] = { ...payload.prompt };
      runs[payload.run.id] = { ...payload.run };
      currentPrompt = payload.prompt.id;
      currentRun = payload.run.id;
    } else if (event.type === "prompt.step" && payload.prompt) {
      if (prompts[payload.prompt]) prompts[payload.prompt].step = payload.step;
      if (payload.run && runs[payload.run]) runs[payload.run].step = payload.step;
    } else if (
      ["prompt.completed", "prompt.failed", "prompt.waived"].includes(event.type) &&
      payload.prompt
    ) {
      if (prompts[payload.prompt]) prompts[payload.prompt].status = payload.status;
      if (payload.run && runs[payload.run]) {
        runs[payload.run].status = payload.status;
      }
      if (currentPrompt === payload.prompt) {
        currentPrompt = null;
        currentRun = null;
      }
    } else if (event.type === "handoff.created" && payload.id) {
      lastHandoff = payload.id;
    } else if (event.type === "handoff.accepted" && payload.id) {
      lastHandoff = payload.id;
      acceptedHandoffs.add(payload.id);
    }
  }

  state.activeIteration = active;
  state.prompts = prompts;
  state.runs = runs;
  state.currentPrompt = currentPrompt;
  state.currentRun = currentRun;
  state.lastHandoff = lastHandoff;
  state.lastIteration = lastClosed || state.lastIteration;
  state.phase = phase;
  state.iterationTitle = title || state.iterationTitle;
  state.gates = gates;
  state.lastEvent = last ? last.eventId : state.lastEvent;
  state.memoryEvent = lastMemory ?? state.memoryEvent;

  let acceptedHandoff = null;
  if (active && !args.noHandoff) {
    const requested = args.handoff || "latest";
    const found = findHandoff(root, config, state, requested);
    if (found) {
      if (!acceptedHandoffs.has(found.data.id)) {
        acceptHandoff(root, config, state, found, {
          currentAgent: args.currentAgent,
          currentModel: args.currentModel,
        });
      }
      acceptedHandoff = found;
    } else if (requested !== "latest") {
      throw new OrchidError(`handoff not found: ${requested}`);
    }
  }

  const routing = PHASE_NAMES.includes(state.phase)
    ? routingFor(root, config, state, state.phase, state.currentPrompt)
    : null;
  writeState(root, state);
  writeProjection(root, config, state);
  if (args.json) {
    process.stdout.write(
      `${formatJson({
        activeIteration: active,
        phase,
        gates,
        lastEvent: state.lastEvent,
        handoff: acceptedHandoff ? acceptedHandoff.data.id : null,
        currentPrompt: state.currentPrompt,
        currentRun: state.currentRun,
        routing,
      })}\n`,
    );
    return 0;
  }
  process.stdout.write(`Resumed at ${phase}${active ? ` (${active})` : ""}\n`);
  if (acceptedHandoff) process.stdout.write(`  handoff ${acceptedHandoff.data.id}\n`);
  if (state.currentPrompt) {
    const prompt = state.prompts[state.currentPrompt];
    process.stdout.write(
      `  prompt ${state.currentPrompt} (${prompt.status}) step=${prompt.step || "—"} attempt=${prompt.attempt || 1}\n`,
    );
  }
  process.stdout.write(`  last event ${state.lastEvent || "none"}\n`);
  if (routing) {
    process.stdout.write(
      `  routing ${routing.effort} (${routing.source}) → ${routing.expectedText || "unassigned"}\n`,
    );
    process.stdout.write(`  current ${routing.currentText} (${routing.status})\n`);
    if (routing.message && ["unknown", "mismatch"].includes(routing.status)) {
      process.stdout.write(`  [alert] ${routing.message}\n`);
    }
  }
  return 0;
}

function matrixSummary(iteration) {
  const file = path.join(iteration, "plan", "matrix.json");
  if (!exists(file)) return null;
  try {
    const matrix = JSON.parse(fs.readFileSync(file, "utf8"));
    const prompts = Array.isArray(matrix) ? matrix : matrix.prompts || [];
    const counts = {};
    for (const prompt of prompts) counts[prompt.status || "unknown"] = (counts[prompt.status || "unknown"] || 0) + 1;
    return { total: prompts.length, counts };
  } catch {
    return null;
  }
}

export function status(root, args) {
  const { config, state } = context(root);
  const manifestFile = paths(root, config).manifest;
  const manifest = exists(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  const id = state.activeIteration || state.lastIteration;
  const iteration = id ? path.join(paths(root, config).iterations, id) : null;
  const matrix = iteration ? matrixSummary(iteration) : null;
  const workspace = workspaceStatus(root, config);
  const steering = steeringFor(root, config, state.phase, args.skillRoot);
  const routing = PHASE_NAMES.includes(state.phase)
    ? routingFor(root, config, state, state.phase)
    : null;
  const currentPrompt = state.currentPrompt && state.prompts[state.currentPrompt]
    ? state.prompts[state.currentPrompt]
    : null;
  const currentRun = currentPrompt && state.currentRun
    ? state.runs[state.currentRun] || null
    : null;
  const payload = {
    project: config.project.name,
    profile: config.project.profile,
    phase: state.phase,
    activeIteration: state.activeIteration,
    lastIteration: state.lastIteration,
    iterationTitle: state.iterationTitle,
    gates: state.gates,
    nodes: manifest ? manifest.nodes.length : 0,
    history: manifest ? manifest.history.length : 0,
    matrix,
    workspace,
    currentPrompt,
    currentRun,
    steering: steering.rules.map((rule) => rule.id),
    steeringArtifact: steering.rules.length ? steeringArtifact(state.phase) : null,
    routing,
    next: nextAction(state.phase),
  };
  if (args.json) {
    process.stdout.write(`${formatJson(payload)}\n`);
    return 0;
  }
  process.stdout.write(`Project  ${config.project.name} (${config.project.profile})\n`);
  process.stdout.write(`Phase    ${state.phase}\n`);
  process.stdout.write(`Active   ${state.activeIteration || "—"}\n`);
  if (state.iterationTitle) process.stdout.write(`Title    ${state.iterationTitle}\n`);
  const gates = Object.entries(state.gates).map(([name, value]) => `${name}:${value}`).join(" ");
  process.stdout.write(`Gates    ${gates}\n`);
  if (manifest) process.stdout.write(`Memory   ${manifest.nodes.length} node(s), ${manifest.history.length} archived iteration(s)\n`);
  if (matrix) {
    const counts = Object.entries(matrix.counts).map(([key, value]) => `${key}=${value}`).join(" ");
    process.stdout.write(`Prompts  ${matrix.total} (${counts})\n`);
  }
  if (currentPrompt) {
    process.stdout.write(
      `Prompt   ${currentPrompt.id} (${currentPrompt.status}) step=${currentPrompt.step || "—"} attempt=${currentPrompt.attempt || 1}\n`,
    );
  }
  if (steering.rules.length) {
    process.stdout.write(
      `Steering ${steering.rules.map((rule) => `${rule.id}[${rule.authority}]`).join(", ")}\n`,
    );
  }
  if (routing) printRouting(routing);
  if (workspace.length) {
    process.stdout.write(`Workspace ${workspace.length} repo(s)\n`);
    for (const repo of workspace) {
      const info = repo.git || {};
      process.stdout.write(
        `  ${repo.id.padEnd(24)} ${(info.branch || "—").padEnd(24)} ${info.head || "—"} ${info.dirty ? `${info.dirty} dirty` : "clean"}\n`,
      );
    }
  }
  process.stdout.write(`Next     ${payload.next}\n`);
  return 0;
}

function collectFiles(dir, skip = new Set()) {
  const out = [];
  if (!exists(dir)) return out;
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(rel(dir, full));
    }
  }
  walk(dir);
  return out.sort();
}

export function diff(root, args) {
  const skillRoot = args.skillRoot;
  const { config } = loadConfig(root);
  const personaDirs = [];
  for (const pattern of config.personas.search_paths || []) {
    for (const dir of expandDirs(root, pattern)) {
      if (!personaDirs.includes(dir)) personaDirs.push(dir);
    }
  }
  if (!personaDirs.length) personaDirs.push(path.join(root, ".orchid", "personas"));
  const steeringDirs = [];
  for (const pattern of (config.steering && config.steering.search_paths) || [".orchid/steering"]) {
    for (const dir of expandDirs(root, pattern)) {
      if (!steeringDirs.includes(dir)) steeringDirs.push(dir);
    }
  }
  if (!steeringDirs.length) steeringDirs.push(path.join(root, ".orchid", "steering"));
  const sources = [
    {
      label: "custom",
      dir: path.join(root, config.customizations_folder),
      base: path.join(skillRoot, ".skill"),
    },
    ...personaDirs.map((dir) => ({
      label: "personas",
      dir,
      base: path.join(skillRoot, ".skill", "personas"),
    })),
    ...steeringDirs.map((dir) => ({
      label: "steering",
      dir,
      base: path.join(skillRoot, ".skill", "steering"),
    })),
    {
      label: "constitution",
      dir: path.join(root, config.constitution_folder),
      base: path.join(skillRoot, ".skill", "constitution"),
    },
  ];
  const rows = [];
  for (const source of sources) {
    for (const relative of collectFiles(source.dir, new Set(["_profile", "README.md"]))) {
      if (args.path && !relative.includes(args.path)) continue;
      const file = path.join(source.dir, relative);
      const base = path.join(source.base, relative);
      let status = "override-only";
      if (exists(base)) {
        status = fs.readFileSync(file, "utf8") === fs.readFileSync(base, "utf8") ? "=" : "M";
      }
      rows.push({ kind: source.label, path: relative, status, file, base });
    }
  }
  if (args.json) {
    process.stdout.write(`${formatJson(rows.map(({ base, file, ...rest }) => rest))}\n`);
    return 0;
  }
  if (!rows.length) {
    process.stdout.write("No overrides found.\n");
    return 0;
  }
  for (const row of rows) {
    process.stdout.write(`${row.status.padEnd(12)} ${row.kind}/${row.path}\n`);
    if (args.content && exists(row.base)) {
      const result = spawnSync("diff", ["-u", row.base, row.file], { encoding: "utf8" });
      if (result.stdout) process.stdout.write(result.stdout);
    }
  }
  return 0;
}

export function migrate(root, args) {
  const { config, state } = context(root);
  const manifestFile = paths(root, config).manifest;
  const manifest = exists(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  if (state.schemaVersion !== 1) {
    throw new OrchidError(`state schemaVersion ${state.schemaVersion} is not supported by this CLI`);
  }
  if (manifest && manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new OrchidError(`manifest schemaVersion ${manifest.schemaVersion} is not supported by this CLI`);
  }
  if (args.json) {
    process.stdout.write(`${formatJson({ state: state.schemaVersion, manifest: manifest ? manifest.schemaVersion : null })}\n`);
    return 0;
  }
  process.stdout.write("Nothing to migrate: state and manifest are current.\n");
  return 0;
}
