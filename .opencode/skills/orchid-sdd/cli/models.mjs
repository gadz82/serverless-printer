import fs from "node:fs";
import path from "node:path";
import { EFFORTS, PHASE_NAMES, loadConfig } from "./config.mjs";
import { paths, readState } from "./store.mjs";
import { OrchidError, exists, formatJson } from "./util.mjs";
import { parseFrontMatter } from "./yaml.mjs";

const PROMPT_RE = /^P-[0-9]{3}$/;

function requirePhase(phase) {
  if (!PHASE_NAMES.includes(phase)) {
    throw new OrchidError(`phase must be one of: ${PHASE_NAMES.join(", ")}`);
  }
}

function promptFileEffort(root, config, iteration, prompt) {
  if (!iteration) return null;
  const file = path.join(
    paths(root, config).iterations,
    iteration,
    "plan",
    "prompts",
    `${prompt}.md`,
  );
  if (!exists(file)) return null;
  try {
    const { data } = parseFrontMatter(fs.readFileSync(file, "utf8"));
    return data.effort ? String(data.effort) : null;
  } catch {
    return null;
  }
}

export function resolveRoute(root, config, { phase, prompt = null, iteration = null } = {}) {
  requirePhase(phase);
  if (prompt && !PROMPT_RE.test(prompt)) {
    throw new OrchidError(`prompt must look like P-001: ${prompt}`);
  }

  let effort = null;
  let source = null;
  if (prompt) {
    const configured = config.models.prompts && config.models.prompts[prompt];
    if (typeof configured === "string") {
      effort = configured;
      source = `models.prompts.${prompt}`;
    } else if (configured && typeof configured === "object" && configured[phase]) {
      effort = String(configured[phase]);
      source = `models.prompts.${prompt}.${phase}`;
    } else {
      const fromFile = promptFileEffort(root, config, iteration, prompt);
      if (fromFile) {
        effort = fromFile;
        source = `${prompt}.effort`;
      }
    }
  }
  if (!effort) {
    effort = config.models.phases[phase] || config.models.default_effort;
    source = config.models.phases[phase] ? `models.phases.${phase}` : "models.default_effort";
  }
  if (!EFFORTS.includes(effort)) {
    throw new OrchidError(`unknown effort "${effort}" for ${prompt || phase}`);
  }
  const requestedEffort = effort;
  const requestedSource = source;
  const efforts = config.models.efforts || {};
  if (!efforts[effort]) {
    const fallback = config.models.default_effort;
    if (fallback !== effort && efforts[fallback]) {
      effort = fallback;
      source = `models.default_effort (fallback from ${requestedSource})`;
    }
  }
  const mapping = efforts[effort] || {};
  return {
    phase,
    prompt,
    effort,
    requestedEffort,
    source,
    requestedSource,
    expected: {
      agent: mapping.agent || null,
      model: mapping.model || null,
    },
  };
}

export function detectCurrentIdentity({ agent = null, model = null, env = process.env } = {}) {
  let currentAgent = agent || env.ORCHID_CURRENT_AGENT || null;
  let agentSource = agent ? "argument" : env.ORCHID_CURRENT_AGENT ? "ORCHID_CURRENT_AGENT" : null;
  if (!currentAgent && env.CLAUDECODE === "1") {
    currentAgent = "claude-code";
    agentSource = "CLAUDECODE";
  }
  if (!currentAgent && env.OPENCODE) {
    currentAgent = "opencode";
    agentSource = "OPENCODE";
  }
  const currentModel = model || env.ORCHID_CURRENT_MODEL || null;
  return {
    agent: currentAgent,
    agentSource,
    model: currentModel,
    modelSource: model ? "argument" : env.ORCHID_CURRENT_MODEL ? "ORCHID_CURRENT_MODEL" : null,
  };
}

export function evaluateRoute(route, current) {
  const expected = route.expected;
  const requiresIdentity = Boolean(expected.agent || expected.model);
  const unknown =
    (expected.agent && !current.agent) || (expected.model && !current.model);
  const mismatched =
    Boolean(expected.agent && current.agent && expected.agent !== current.agent) ||
    Boolean(expected.model && current.model && expected.model !== current.model);

  let status = "unassigned";
  if (requiresIdentity) status = unknown ? "unknown" : mismatched ? "mismatch" : "match";
  const expectedText = [
    expected.agent ? `agent=${expected.agent}` : null,
    expected.model ? `model=${expected.model}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const currentText = [
    current.agent ? `agent=${current.agent}` : "agent=unknown",
    current.model ? `model=${current.model}` : "model=unknown",
  ].join(" ");
  let message = null;
  if (status === "unassigned") {
    message = `No agent/model is assigned to effort "${route.effort}". Set models.efforts.${route.effort}.agent and/or .model in orchid-sdd.yml.`;
  } else if (status === "unknown") {
    message = `The current model/agent could not be recognized. ${route.phase}${route.prompt ? ` / ${route.prompt}` : ""} expects ${expectedText}. Tell the user; do not switch automatically.`;
  } else if (status === "mismatch") {
    message = `Current ${currentText} does not match expected ${expectedText}. Tell the user; do not switch automatically.`;
  }
  return { ...route, current, status, message, expectedText, currentText };
}

function printRoute(result) {
  process.stdout.write(
    `Route ${result.phase}${result.prompt ? ` / ${result.prompt}` : ""}\n`,
  );
  process.stdout.write(`  effort:   ${result.effort} (${result.source})\n`);
  process.stdout.write(`  expected: ${result.expectedText || "unassigned"}\n`);
  process.stdout.write(`  current:  ${result.currentText}\n`);
  process.stdout.write(`  status:   ${result.status}\n`);
  if (result.message) {
    const label = result.status === "unassigned" ? "[info]" : "[alert]";
    process.stdout.write(`  ${label.padEnd(10)}${result.message}\n`);
  }
}

export function routeCommand(root, args = {}) {
  const { config } = loadConfig(root);
  let state = null;
  try {
    state = readState(root);
  } catch {
    /* explicit --phase can be used before an iteration exists */
  }
  const phase = args.phase || (state && PHASE_NAMES.includes(state.phase) ? state.phase : null);
  if (!phase) {
    throw new OrchidError("route requires --phase until an active workflow phase exists");
  }
  const prompt = args.prompt || null;
  const route = resolveRoute(root, config, {
    phase,
    prompt,
    iteration: state && state.activeIteration,
  });
  const current = detectCurrentIdentity({
    agent: args.currentAgent,
    model: args.currentModel,
  });
  const result = evaluateRoute(route, current);
  if (args.json) {
    process.stdout.write(`${formatJson(result)}\n`);
  } else {
    printRoute(result);
    if (result.status === "mismatch" || result.status === "unknown") {
      process.stdout.write(
        "  action:   Tell the user which agent/model is expected; do not switch automatically.\n",
      );
    }
  }
  if (config.models.mismatch === "block" && result.status === "mismatch") return 1;
  return 0;
}
