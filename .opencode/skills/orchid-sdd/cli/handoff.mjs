import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import {
  detectCurrentIdentity,
  evaluateRoute,
  resolveRoute,
} from "./models.mjs";
import { paths, readState, appendEvent, writeProjection } from "./store.mjs";
import { captureWorkspaceState } from "./workspace.mjs";
import { OrchidError, ensureDir, exists, formatJson, nowIso, uuid7 } from "./util.mjs";

function requireActive(state) {
  if (!state.activeIteration) {
    throw new OrchidError("no active iteration; run `orchid-sdd start` first");
  }
}

function handoffDir(root, config, state) {
  return path.join(paths(root, config).iterations, state.activeIteration, "handoff");
}

export function listHandoffs(root, config, state) {
  const dir = handoffDir(root, config, state);
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
      } catch {
        return { file, data: null };
      }
    });
}

export function findHandoff(root, config, state, id = "latest") {
  const rows = listHandoffs(root, config, state).filter(({ data }) => data);
  if (id === "latest") return rows.length ? rows[rows.length - 1] : null;
  return rows.find(({ data }) => data.id === id) || null;
}

export function acceptHandoff(root, config, state, found, { currentAgent, currentModel } = {}) {
  const id = found.data.id;
  state.lastHandoff = id;
  appendEvent(root, config, state, {
    type: "handoff.accepted",
    subject: `handoff:${id}`,
    payload: {
      id,
      current: detectCurrentIdentity({ agent: currentAgent, model: currentModel }),
      acceptedAt: nowIso(),
    },
  });
  return id;
}

function routeFor(root, config, state) {
  const prompt = state.currentPrompt || null;
  const route = resolveRoute(root, config, {
    phase: state.phase,
    prompt,
    iteration: state.activeIteration,
  });
  return evaluateRoute(route, detectCurrentIdentity());
}

export function handoffCommand(root, args = {}) {
  const { config } = loadConfig(root);
  const state = readState(root);
  requireActive(state);
  const action = String(args.action || "list");

  if (action === "list") {
    const rows = listHandoffs(root, config, state).map(({ file, data }) => ({
      file,
      id: data?.id || path.basename(file, ".json"),
      prompt: data?.prompt || null,
      phase: data?.phase || null,
      reason: data?.reason || null,
      createdAt: data?.createdAt || null,
    }));
    if (args.json) {
      process.stdout.write(`${formatJson(rows)}\n`);
      return 0;
    }
    if (!rows.length) {
      process.stdout.write("No handoffs recorded.\n");
      return 0;
    }
    for (const row of rows) {
      process.stdout.write(
        `${row.id}  phase=${row.phase || "—"} prompt=${row.prompt || "—"} ${row.file}\n`,
      );
    }
    return 0;
  }

  if (action === "show") {
    const id = String(args.id || "");
    if (!id) throw new OrchidError("handoff show requires a handoff id");
    const found = listHandoffs(root, config, state).find(
      ({ data }) => data?.id === id || path.basename(data?.file || "") === id,
    );
    if (!found || !found.data) throw new OrchidError(`handoff not found: ${id}`);
    if (args.json) {
      process.stdout.write(`${formatJson(found.data)}\n`);
      return 0;
    }
    process.stdout.write(`${found.data.id}\n`);
    process.stdout.write(`  phase:  ${found.data.phase}\n`);
    process.stdout.write(`  prompt: ${found.data.prompt || "—"}\n`);
    process.stdout.write(`  reason: ${found.data.reason || "—"}\n`);
    process.stdout.write(`  file:   ${found.file}\n`);
    return 0;
  }

  if (action === "prepare") {
    const id = `handoff-${uuid7()}`;
    const dir = handoffDir(root, config, state);
    ensureDir(dir);
    const file = path.join(dir, `${id}.json`);
    const routing = routeFor(root, config, state);
    const data = {
      schemaVersion: 1,
      id,
      file: path.relative(root, file).split(path.sep).join("/"),
      iteration: state.activeIteration,
      phase: state.phase,
      prompt: state.currentPrompt || null,
      run: state.currentRun || null,
      prompts: state.prompts || {},
      runs: state.runs || {},
      lastEvent: state.lastEvent || null,
      routing,
      workspace: captureWorkspaceState(root, config),
      reason: args.reason ? String(args.reason) : "manual handoff",
      createdAt: nowIso(),
    };
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    state.lastHandoff = id;
    appendEvent(root, config, state, {
      type: "handoff.created",
      subject: `handoff:${id}`,
      payload: {
        id,
        file: path.relative(root, file).split(path.sep).join("/"),
        phase: state.phase,
        prompt: state.currentPrompt || null,
        run: state.currentRun || null,
        reason: data.reason,
        routing: {
          effort: routing.effort,
          status: routing.status,
          expected: routing.expected,
          current: routing.current,
        },
      },
    });
    writeProjection(root, config, state);
    if (args.json) {
      process.stdout.write(`${formatJson(data)}\n`);
      return 0;
    }
    process.stdout.write(`Handoff prepared: ${id}\n`);
    process.stdout.write(`  file:   ${file}\n`);
    process.stdout.write(`  prompt: ${data.prompt || "—"}\n`);
    if (routing.message) process.stdout.write(`  [alert] ${routing.message}\n`);
    return 0;
  }

  if (action === "accept") {
    const id = String(args.id || "");
    if (!id) throw new OrchidError("handoff accept requires a handoff id");
    const found = findHandoff(root, config, state, id);
    if (!found) throw new OrchidError(`handoff not found: ${id}`);
    acceptHandoff(root, config, state, found, {
      currentAgent: args.currentAgent,
      currentModel: args.currentModel,
    });
    writeProjection(root, config, state);
    if (args.json) {
      process.stdout.write(`${formatJson({ accepted: id })}\n`);
      return 0;
    }
    process.stdout.write(`Handoff accepted: ${id}\n`);
    process.stdout.write("  Next: run `orchid-sdd status` and continue from the saved prompt/step.\n");
    return 0;
  }

  throw new OrchidError(`unknown handoff action "${action}" (use list, show, prepare, or accept)`);
}
