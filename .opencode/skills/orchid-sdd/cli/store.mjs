import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_VERSION,
  SKILL_VERSION,
  OrchidError,
  exists,
  ensureDir,
  month,
  nowIso,
  readJson,
  readText,
  sha256,
  sortObject,
  stableStringify,
  stripVolatile,
  sortUnique,
  tokenize,
  uuid7,
  writeJson,
  writeJsonCompact,
} from "./util.mjs";
import { INDEX_REL, ledgerIndex } from "./dependencies.mjs";

export function paths(root, cfg) {
  const knowledge = path.resolve(root, cfg.knowledge_folder);
  return {
    root,
    knowledge,
    manifest: path.join(knowledge, cfg.knowledge.manifest),
    events: path.join(knowledge, "events"),
    index: path.join(knowledge, "index"),
    context: path.join(knowledge, "context"),
    iterations: path.join(knowledge, "iterations"),
    input: path.join(knowledge, "input"),
    runLog: path.resolve(root, cfg.telemetry.run_log),
    state: path.join(root, ".orchid", "state.json"),
    docblocks: path.resolve(root, cfg.docblocks_folder),
    constitution: path.resolve(root, cfg.constitution_folder),
    customizations: path.resolve(root, cfg.customizations_folder),
    steering: path.resolve(
      root,
      (cfg.steering && cfg.steering.search_paths && cfg.steering.search_paths[0]) || ".orchid/steering",
    ),
  };
}

export const GATES = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

// Events that change the recall index content. Gate/phase/route events do not:
// they advance `lastEvent` but leave memory unchanged, so a memory-specific
// revision keeps `recall` from rebuilding after a gate or phase transition.
const MEMORY_EVENT_TYPES = new Set([
  "node.recorded",
  "node.updated",
  "iteration.closed",
  "iteration.abandoned",
]);

/** True when appending `type` changes the recall index content. */
export function isMemoryEventType(type) {
  return MEMORY_EVENT_TYPES.has(type);
}

/** The memory-specific revision used for recall-index freshness. */
export function memoryRevision(state) {
  return state.memoryEvent ?? state.lastEvent ?? null;
}

export function newState(cfg, configHash) {
  return {
    schemaVersion: 1,
    skillVersion: SKILL_VERSION,
    configHash,
    activeIteration: null,
    lastIteration: null,
    iterationTitle: null,
    iterationRigor: null,
    phase: "setup",
    gates: Object.fromEntries(GATES.map((gate) => [gate, "pending"])),
    locks: {},
    prompts: {},
    runs: {},
    currentPrompt: null,
    currentRun: null,
    lastHandoff: null,
    lastEvent: null,
    memoryEvent: null,
  };
}

export function readState(root) {
  const file = path.join(root, ".orchid", "state.json");
  if (!exists(file)) throw new OrchidError("no .orchid/state.json; run `orchid-sdd setup` first");
  const state = readJson(file);
  state.prompts = state.prompts || {};
  state.runs = state.runs || {};
  state.currentPrompt = state.currentPrompt || null;
  state.currentRun = state.currentRun || null;
  state.lastHandoff = state.lastHandoff || null;
  state.memoryEvent = state.memoryEvent ?? state.lastEvent ?? null;
  return state;
}

export function writeState(root, state) {
  const file = path.join(root, ".orchid", "state.json");
  writeJson(file, state);
}

export function appendEvent(root, cfg, state, { type, subject = null, payload = {}, actor = "orchestrator", phase = null }) {
  const p = paths(root, cfg);
  ensureDir(p.events);
  const file = path.join(p.events, `${month()}.jsonl`);
  let prev = null;
  if (exists(file)) {
    const lines = readText(file).split("\n").filter(Boolean);
    if (lines.length) prev = sha256(lines[lines.length - 1]);
  }
  const event = {
    eventId: uuid7(),
    ts: nowIso(),
    iteration: state.activeIteration || null,
    phase: phase || state.phase || "setup",
    actor,
    type,
    subject,
    payload,
    prev,
  };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  state.lastEvent = event.eventId;
  if (MEMORY_EVENT_TYPES.has(type)) state.memoryEvent = event.eventId;
  writeState(root, state);
  return event;
}

export function readEvents(root, cfg) {
  const dir = paths(root, cfg).events;
  if (!exists(dir)) return [];
  const events = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    const file = path.join(dir, name);
    const lines = readText(file).split("\n");
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        throw new OrchidError(`invalid event JSON at ${name}:${i + 1}: ${error.message}`);
      }
    });
  }
  return events;
}

function readPlan(root, cfg, iteration) {
  if (!iteration) return null;
  const file = path.join(paths(root, cfg).iterations, iteration, "plan", "plan.json");
  if (!exists(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function buildDependencies(plan) {
  const deps = {};
  if (!plan) return deps;
  let prompts = [];
  if (Array.isArray(plan.prompts)) prompts = plan.prompts;
  else if (plan.prompts && typeof plan.prompts === "object") {
    prompts = Object.entries(plan.prompts).map(([id, value]) => ({ id, ...value }));
  }
  for (const prompt of prompts) {
    if (!prompt || !prompt.id) continue;
    deps[prompt.id] = {
      dependsOn: prompt.dependsOn || prompt.depends_on || [],
      wave: prompt.wave || null,
      writeScopes: prompt.writeScopes || (prompt.scope && prompt.scope.write) || [],
    };
  }
  return deps;
}

function push(index, key, value) {
  if (key === null || key === undefined || key === "") return;
  if (!index[key]) index[key] = [];
  index[key].push(value);
}

function sortedIndex(index) {
  const out = {};
  for (const key of Object.keys(index).sort()) out[key] = sortUnique(index[key]);
  return out;
}

export function buildIndexes(nodes, events, plan) {
  const topics = {};
  const questions = {};
  const codeAnchors = {};
  const supersession = {};
  const requirements = {};
  const repos = {};

  for (const node of nodes) {
    const id = node["@id"];
    for (const topic of node.topics || []) push(topics, String(topic), id);
    for (const question of node.answers || []) push(questions, String(question), id);
    if (node.codeAnchor) push(codeAnchors, String(node.codeAnchor), id);
    if (node.repo) push(repos, String(node.repo), id);
    for (const relation of node.relations || []) {
      if (relation.predicate === "supersedes" && relation.target) {
        push(supersession, String(relation.target), id);
      }
    }
  }

  for (const node of nodes) {
    if (node["@type"] !== "orchid:Requirement") continue;
    const key = (node.aliases && node.aliases[0]) || node["@id"];
    const entry = {
      id: node["@id"],
      description: node.description || "",
      scenarios: [],
      prompts: [],
      tests: [],
      anchors: [],
      decisions: [],
    };
    for (const other of nodes) {
      for (const relation of other.relations || []) {
        const isTarget =
          relation.target === node["@id"] ||
          (node.aliases || []).includes(relation.target);
        if (!isTarget) continue;
        const type = other["@type"];
        if (type === "orchid:Scenario") entry.scenarios.push(other["@id"]);
        else if (type === "orchid:Prompt") entry.prompts.push(other["@id"]);
        else if (type === "orchid:CodeUnit") entry.anchors.push(other["@id"]);
        else if (type === "orchid:Decision") entry.decisions.push(other["@id"]);
        else if (type === "orchid:Test") entry.tests.push(other["@id"]);
      }
    }
    for (const field of ["scenarios", "prompts", "tests", "anchors", "decisions"]) {
      entry[field] = sortUnique(entry[field]);
    }
    requirements[key] = entry;
  }

  const timeline = events.map((event) => ({
    ts: event.ts,
    event: event.type,
    iteration: event.iteration,
    phase: event.phase,
    subject: event.subject,
  }));

  return {
    topics: sortedIndex(topics),
    questions: sortedIndex(questions),
    codeAnchors: sortedIndex(codeAnchors),
    requirements: sortObject(requirements),
    dependencies: sortObject(buildDependencies(plan)),
    timeline,
    supersession: sortedIndex(supersession),
    repos: sortedIndex(repos),
  };
}

export const RECALL_INDEX_REL = "index/recall.json";
export const RECALL_SCHEMA_VERSION = 3;

function compactRecallNode(node, snapshot) {
  const isProject =
    node.scope === "project" || node.iteration === null || node.iteration === "project";
  return {
    id: node["@id"],
    type: node["@type"] || null,
    scope: isProject ? "project" : "iteration",
    iteration: isProject ? null : node.iteration || null,
    aliases: (node.aliases || []).slice(),
    topics: (node.topics || []).slice(),
    questions: (node.answers || []).slice(),
    codeAnchor: node.codeAnchor || null,
    description: node.description || "",
    artifact: node.artifact || null,
    supersededBy: null,
    repo: node.repo || null,
    relations: (node.relations || []).map((relation) => ({
      predicate: relation.predicate,
      target: relation.target,
    })),
    createdAt: node.createdAt || null,
    snapshot,
  };
}

/**
 * Build the generated recall index from the freshly projected manifest and the
 * archived iteration snapshots. Active manifest nodes win deduplication over
 * historical copies; historical nodes carry a relative `snapshot` path so recall
 * can hydrate them lazily. Maps are lowercase and deterministically sorted.
 */
export function buildRecallIndex(root, cfg, manifest, state, iterations) {
  const byId = new Map();
  for (const node of manifest.nodes || []) {
    byId.set(node["@id"], compactRecallNode(node, null));
  }

  // Chronological rank from the event stream (start order), so "recent" reflects
  // real creation order even when iteration names sort differently or closes land
  // in the same second.
  const rankByIteration = new Map();
  let rank = 0;
  for (const id of iterations ? iterations.keys() : []) {
    rankByIteration.set(id, rank);
    rank += 1;
  }

  const historyEntries = [];
  for (const entry of manifest.history || []) {
    if (!entry.manifest) continue;
    const file = path.join(paths(root, cfg).knowledge, entry.manifest);
    if (!exists(file)) continue;
    let snapshotNodes = [];
    try {
      snapshotNodes = readJson(file).nodes || [];
    } catch {
      continue;
    }
    for (const node of snapshotNodes) {
      if (!byId.has(node["@id"])) byId.set(node["@id"], compactRecallNode(node, entry.manifest));
    }
    historyEntries.push({
      iteration: entry.iteration,
      snapshot: entry.manifest,
      rank: rankByIteration.get(entry.iteration) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  historyEntries.sort(
    (a, b) => a.rank - b.rank || a.iteration.localeCompare(b.iteration),
  );
  const history = historyEntries.map(({ iteration, snapshot }) => ({ iteration, snapshot }));

  const entries = [...byId.values()];

  // supersededBy: the first node with a `supersedes` relation targeting this node.
  const superseding = new Map();
  for (const entry of entries) {
    for (const relation of entry.relations || []) {
      if (relation.predicate !== "supersedes" || !relation.target) continue;
      const key = String(relation.target).replace(/^urn:uuid:/, "").toLowerCase();
      if (!superseding.has(key)) superseding.set(key, entry.id);
    }
  }
  for (const entry of entries) {
    const direct = superseding.get(String(entry.id).replace(/^urn:uuid:/, "").toLowerCase());
    const viaAlias = (entry.aliases || [])
      .map((alias) => superseding.get(String(alias).toLowerCase()))
      .find(Boolean);
    entry.supersededBy = direct || viaAlias || null;
  }

  entries.sort((a, b) => {
    const createdA = String(a.createdAt || "");
    const createdB = String(b.createdAt || "");
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  const terms = {};
  const topicsIndex = {};
  const aliasesIndex = {};
  const questionsIndex = {};
  const codeAnchorsIndex = {};
  const push = (index, key, value) => {
    if (key === null || key === undefined || key === "") return;
    if (!index[key]) index[key] = [];
    index[key].push(value);
  };

  // `terms` indexes alias/topic/question/code-anchor/description tokens only.
  // The exact `@id` is not indexed: recall resolves UUIDs via `nodes` directly, and
  // per-node UUID hex tokens would dominate the posting list and bloat the index.
  for (const entry of entries) {
    const text = [
      ...(entry.aliases || []),
      ...(entry.topics || []),
      ...(entry.questions || []),
      entry.codeAnchor || "",
      entry.description || "",
    ].join(" ");
    for (const token of new Set(tokenize(text))) push(terms, token, entry.id);
    for (const topic of entry.topics || []) push(topicsIndex, String(topic).toLowerCase(), entry.id);
    for (const alias of entry.aliases || []) push(aliasesIndex, String(alias).toLowerCase(), entry.id);
    for (const question of entry.questions || []) {
      push(questionsIndex, String(question).toLowerCase(), entry.id);
    }
    if (entry.codeAnchor) push(codeAnchorsIndex, String(entry.codeAnchor).toLowerCase(), entry.id);
  }

  const aliasesIndexSorted = sortedIndex(aliasesIndex);

  // Canonical reference resolution (exact id, then most-recent alias) used to build
  // the reverse-relation map. Mirrors recall's resolveId so hop expansion is O(degree).
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const snapshotRank = new Map();
  history.forEach((entry, i) => snapshotRank.set(entry.snapshot, i));
  const activeRank = history.length;
  function pickMostRecent(ids) {
    let best = null;
    let bestRank = -Infinity;
    let bestCreated = "";
    let bestId = "";
    for (const id of ids) {
      const entry = entriesById.get(id);
      if (!entry) continue;
      const entryRank =
        entry.snapshot === null ? activeRank : (snapshotRank.get(entry.snapshot) ?? -1);
      const created = entry.createdAt || "";
      if (
        entryRank > bestRank ||
        (entryRank === bestRank && (created > bestCreated || (created === bestCreated && id > bestId)))
      ) {
        best = id;
        bestRank = entryRank;
        bestCreated = created;
        bestId = id;
      }
    }
    return best;
  }

  const canonical = new Map();
  for (const entry of entries) {
    canonical.set(String(entry.id).replace(/^urn:uuid:/, "").toLowerCase(), entry.id);
  }
  for (const [alias, ids] of Object.entries(aliasesIndexSorted)) {
    canonical.set(alias, pickMostRecent(ids));
  }

  const incomingRelations = {};
  for (const entry of entries) {
    for (const relation of entry.relations || []) {
      const key = String(relation.target).replace(/^urn:uuid:/, "").toLowerCase();
      const targetId = canonical.get(key) || (entriesById.has(relation.target) ? relation.target : null);
      if (targetId) push(incomingRelations, targetId, entry.id);
    }
  }

  // Postings store node ordinals rather than repeating 38-character UUIDs in every
  // list. `nodes` is the ordinal table; recall expands the maps once after loading.
  const ordinalById = new Map(entries.map((entry, ordinal) => [entry.id, ordinal]));
  const compact = (index) => {
    const out = {};
    for (const [key, ids] of Object.entries(index)) {
      out[key] = ids.map((id) => ordinalById.get(id)).filter((ordinal) => ordinal !== undefined);
    }
    return sortedIndex(out);
  };
  const incomingCompact = {};
  for (const [targetId, sourceIds] of Object.entries(incomingRelations)) {
    const targetOrdinal = ordinalById.get(targetId);
    if (targetOrdinal === undefined) continue;
    incomingCompact[targetOrdinal] = sourceIds
      .map((id) => ordinalById.get(id))
      .filter((ordinal) => ordinal !== undefined);
  }

  return {
    generatedAt: nowIso(),
    schemaVersion: RECALL_SCHEMA_VERSION,
    activeIteration: state.activeIteration || null,
    lastEventId: memoryRevision(state),
    history,
    nodes: entries,
    terms: compact(terms),
    topicsIndex: compact(topicsIndex),
    aliasesIndex: compact(aliasesIndexSorted),
    questionsIndex: compact(questionsIndex),
    codeAnchorsIndex: compact(codeAnchorsIndex),
    incomingRelations: sortedIndex(incomingCompact),
  };
}

/**
 * Expand ordinal postings from the on-disk recall index back to node ids. The
 * generated file stays compact; callers see the same shape as before.
 */
export function expandRecallIndex(index) {
  const ids = (index.nodes || []).map((entry) => entry.id);
  const expand = (postings) => {
    const out = {};
    for (const [key, ordinals] of Object.entries(postings || {})) {
      out[key] = (ordinals || []).map((ordinal) => ids[ordinal]).filter(Boolean);
    }
    return out;
  };
  const expanded = {
    ...index,
    terms: expand(index.terms),
    topicsIndex: expand(index.topicsIndex),
    aliasesIndex: expand(index.aliasesIndex),
    questionsIndex: expand(index.questionsIndex),
    codeAnchorsIndex: expand(index.codeAnchorsIndex),
    incomingRelations: {},
  };
  for (const [ordinal, sourceOrdinals] of Object.entries(index.incomingRelations || {})) {
    const target = ids[Number(ordinal)];
    if (!target) continue;
    expanded.incomingRelations[target] = (sourceOrdinals || [])
      .map((sourceOrdinal) => ids[sourceOrdinal])
      .filter(Boolean);
  }
  return expanded;
}

/**
 * Return null when the generated index can serve the current state, otherwise a
 * short reason. Active iteration and schema are part of freshness: recovery can
 * change the active set without appending a memory event, and an old index must
 * not be reused after its format changes.
 */
export function recallIndexProblem(index, state) {
  if (!index || typeof index !== "object") return "missing";
  if (index.schemaVersion !== RECALL_SCHEMA_VERSION) return "schema";
  if ((index.activeIteration ?? null) !== (state.activeIteration ?? null)) return "iteration";
  if ((index.lastEventId ?? null) !== memoryRevision(state)) return "revision";
  return null;
}

/**
 * Load the recall index, rebuilding it when it is missing or stale (its `lastEventId`
 * no longer matches the memory-specific revision, its active iteration differs, or
 * its schema version is unsupported). This keeps `recall` correct after a `record`
 * without paying the full rebuild on every write, and it does not rebuild after
 * gate/phase events that leave memory unchanged.
 */
export function loadRecallIndexFresh(root, cfg, state) {
  const file = path.join(paths(root, cfg).index, "recall.json");
  if (exists(file)) {
    try {
      const index = readJson(file);
      if (!recallIndexProblem(index, state)) return expandRecallIndex(index);
    } catch {
      /* fall through to rebuild */
    }
  }
  const { indexes } = project(root, cfg, state, { recall: true });
  writeJsonCompact(file, indexes.recall);
  return expandRecallIndex(indexes.recall);
}

export function project(root, cfg, state, options = {}) {
  const events = readEvents(root, cfg);
  const nodes = new Map();
  const iterations = new Map();
  const gates = { ...state.gates };

  for (const event of events) {
    const payload = event.payload || {};
    if (event.type === "node.recorded" && payload.node) {
      const node = { ...payload.node };
      if (!node.iteration) node.iteration = event.iteration;
      nodes.set(node["@id"], node);
    } else if (event.type === "node.updated" && payload.id) {
      const current = nodes.get(payload.id);
      if (current) nodes.set(payload.id, { ...current, ...(payload.patch || {}), updatedAt: event.ts });
    } else if (event.type === "iteration.started" && payload.id) {
      iterations.set(payload.id, { ...payload });
    } else if ((event.type === "iteration.closed" || event.type === "iteration.abandoned") && payload.id) {
      iterations.set(payload.id, { ...(iterations.get(payload.id) || { id: payload.id }), ...payload });
    } else if (event.type === "gate.passed" && payload.gate) {
      gates[payload.gate] = "passed";
    } else if (event.type === "gate.failed" && payload.gate) {
      gates[payload.gate] = "failed";
    }
  }

  const active = state.activeIteration;
  const projectNodes = [...nodes.values()].filter(
    (node) => node.scope === "project" || node.iteration === null || node.iteration === "project",
  );
  const iterationNodes = active
    ? [...nodes.values()].filter((node) => node.iteration === active)
    : [];
  const manifestNodes = [
    ...new Map(
      [...projectNodes, ...iterationNodes].map((node) => [node["@id"], node]),
    ).values(),
  ].sort(
    (a, b) =>
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
      a["@id"].localeCompare(b["@id"]),
  );
  const plan = readPlan(root, cfg, active);
  const indexes = buildIndexes(manifestNodes, events, plan);
  indexes.crossRepoDependencies = ledgerIndex(root, cfg);
  const meta = active ? iterations.get(active) || {} : {};

  const history = [];
  const seen = new Set();
  if (exists(paths(root, cfg).iterations)) {
    const dirs = fs.readdirSync(paths(root, cfg).iterations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of dirs) {
      if (name === active || seen.has(name)) continue;
      const snapshot = path.join(paths(root, cfg).iterations, name, "iteration.jsonld");
      if (exists(snapshot)) {
        try {
          const data = readJson(snapshot);
          const iteration = data.iteration || {};
          history.push({
            iteration: name,
            manifest: `iterations/${name}/iteration.jsonld`,
            summary: `${iteration.title || name} — ${iteration.status || "closed"}`,
            status: iteration.status || "closed",
          });
          seen.add(name);
        } catch {
          /* ignore unreadable snapshots; doctor reports them */
        }
      }
    }
  }
  for (const [id, iteration] of iterations) {
    if (id === active || seen.has(id)) continue;
    history.push({
      iteration: id,
      manifest: null,
      summary: `${iteration.title || id} — ${iteration.status || "closed"}`,
      status: iteration.status || "closed",
    });
    seen.add(id);
  }
  history.sort((a, b) => a.iteration.localeCompare(b.iteration));

  const manifest = {
    "@context": "context/orchid-v1.jsonld",
    "@id": `urn:orchid:manifest:${String(cfg.project.name).replace(/[^A-Za-z0-9._-]+/g, "-")}:${active || "none"}`,
    "@type": "orchid:Manifest",
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(),
    project: { name: cfg.project.name, profile: cfg.project.profile },
    iteration: active
      ? {
          "@id": `urn:orchid:iteration:${active}`,
          title: meta.title || state.iterationTitle || active,
          phase: state.phase,
          status: "active",
          specVersion: meta.specVersion || "1.0.0",
          rigor: meta.rigor || state.iterationRigor || "M",
        }
      : null,
    gates,
    indexes: {
      topics: "index/topics.json",
      questions: "index/questions.json",
      codeAnchors: "index/code-anchors.json",
      requirements: "index/requirements.json",
      dependencies: "index/dependencies.json",
      timeline: "index/timeline.json",
      repos: "index/repos.json",
      crossRepoDependencies: INDEX_REL,
      recall: RECALL_INDEX_REL,
    },
    workspace:
      cfg.workspace && cfg.workspace.enabled
        ? {
            enabled: true,
            repos: (cfg.workspace.repos || []).map((repo) => ({
              id: repo.id,
              path: repo.path,
              profile: repo.profile,
              enabled: repo.enabled !== false,
              git: repo.git !== false,
            })),
          }
        : { enabled: false, repos: [] },
    history,
    nodes: manifestNodes,
  };

  if (options.recall) {
    indexes.recall = buildRecallIndex(root, cfg, manifest, state, iterations);
  }

  return { manifest, indexes, events, nodes: [...nodes.values()], iterations };
}

export function writeProjection(root, cfg, state, options = {}) {
  const p = paths(root, cfg);
  const { manifest, indexes } = project(root, cfg, state, options);
  ensureDir(p.index);
  writeJson(p.manifest, manifest);
  writeJson(path.join(p.index, "topics.json"), indexes.topics);
  writeJson(path.join(p.index, "questions.json"), indexes.questions);
  writeJson(path.join(p.index, "code-anchors.json"), indexes.codeAnchors);
  writeJson(path.join(p.index, "requirements.json"), indexes.requirements);
  writeJson(path.join(p.index, "dependencies.json"), indexes.dependencies);
  writeJson(path.join(p.index, "timeline.json"), indexes.timeline);
  writeJson(path.join(p.index, "supersession.json"), indexes.supersession);
  writeJson(path.join(p.index, "repos.json"), indexes.repos);
  writeJson(path.join(p.index, "cross-repo-dependencies.json"), indexes.crossRepoDependencies);
  if (options.recall) writeJsonCompact(path.join(p.index, "recall.json"), indexes.recall);
  return { manifest, indexes };
}

export function checkProjection(root, cfg, state) {
  const p = paths(root, cfg);
  const drift = [];
  if (!exists(p.manifest)) return ["manifest.jsonld"];
  const built = project(root, cfg, state, { recall: false });
  const diskManifest = readJson(p.manifest);
  if (stableStringify(stripVolatile(diskManifest)) !== stableStringify(stripVolatile(built.manifest))) {
    drift.push("manifest.jsonld");
  }
  const files = {
    "topics.json": built.indexes.topics,
    "questions.json": built.indexes.questions,
    "code-anchors.json": built.indexes.codeAnchors,
    "requirements.json": built.indexes.requirements,
    "dependencies.json": built.indexes.dependencies,
    "timeline.json": built.indexes.timeline,
    "supersession.json": built.indexes.supersession,
    "repos.json": built.indexes.repos,
    "cross-repo-dependencies.json": built.indexes.crossRepoDependencies,
  };
  // `recall.json` is a generated, Git-ignored artifact and is deliberately not
  // drift-checked: a missing or stale recall index is rebuilt on demand by
  // `recall` or by `orchid-sdd index`, never treated as projection drift.
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(p.index, name);
    if (!exists(file)) {
      drift.push(`index/${name}`);
      continue;
    }
    if (stableStringify(stripVolatile(readJson(file))) !== stableStringify(stripVolatile(value))) {
      drift.push(`index/${name}`);
    }
  }
  return drift;
}

export function loadManifest(root, cfg) {
  const file = paths(root, cfg).manifest;
  if (!exists(file)) throw new OrchidError(`${file} is missing; run \`orchid-sdd index\``);
  return readJson(file);
}

/**
 * Load the active manifest nodes and each archived iteration snapshot's nodes,
 * split so callers can distinguish active from historical nodes.
 */
export function loadManifestNodes(root, cfg) {
  const manifest = loadManifest(root, cfg);
  const active = manifest.nodes || [];
  const history = [];
  for (const entry of manifest.history || []) {
    if (!entry.manifest) continue;
    const file = path.join(paths(root, cfg).knowledge, entry.manifest);
    if (exists(file)) {
      try {
        history.push(...(JSON.parse(fs.readFileSync(file, "utf8")).nodes || []));
      } catch {
        /* doctor reports unreadable history */
      }
    }
  }
  return { active, history };
}

/**
 * Load every memory node: the active manifest plus each archived iteration
 * snapshot referenced by `history`, deduplicated by `@id` (active manifest nodes
 * win over historical copies). Keeps closed-iteration recall working without
 * returning a project-scoped node twice after close.
 */
export function loadAllNodes(root, cfg) {
  const { active, history } = loadManifestNodes(root, cfg);
  const byId = new Map();
  for (const node of active) byId.set(node["@id"], node);
  for (const node of history) if (!byId.has(node["@id"])) byId.set(node["@id"], node);
  return [...byId.values()];
}

export function writeIterationSnapshot(root, cfg, state, status, reason = null, workspace = null) {
  const id = state.activeIteration;
  if (!id) throw new OrchidError("no active iteration to snapshot");
  const { manifest } = project(root, cfg, state);
  const dir = path.join(paths(root, cfg).iterations, id);
  if (!exists(dir)) throw new OrchidError(`iteration directory is missing: ${dir}`);
  const snapshot = {
    "@context": "context/orchid-v1.jsonld",
    "@id": `urn:orchid:iteration:${id}`,
    "@type": "orchid:IterationSnapshot",
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(),
    project: { name: cfg.project.name, profile: cfg.project.profile },
    iteration: {
      ...(manifest.iteration || { "@id": `urn:orchid:iteration:${id}` }),
      status,
      closedAt: nowIso(),
      ...(reason ? { reason } : {}),
    },
    gates: manifest.gates,
    nodes: manifest.nodes,
    ...(workspace ? { workspace } : {}),
  };
  const file = path.join(dir, "iteration.jsonld");
  writeJson(file, snapshot);
  return file;
}

export function moveMerge(src, dst) {
  if (!exists(src)) return false;
  ensureDir(path.dirname(dst));
  if (!exists(dst)) {
    fs.renameSync(src, dst);
    return true;
  }
  for (const entry of fs.readdirSync(src)) {
    moveMerge(path.join(src, entry), path.join(dst, entry));
  }
  fs.rmSync(src, { recursive: true, force: true });
  return true;
}

export function archiveTransients(root, cfg, state) {
  if (!state.activeIteration) return [];
  const iteration = path.join(paths(root, cfg).iterations, state.activeIteration);
  const audit = path.join(iteration, "audit");
  const moved = [];
  const pairs = [
    [path.join(iteration, "plan", "prompts"), path.join(audit, "prompts"), "prompts"],
    [path.join(iteration, "execution", "runs"), path.join(audit, "runs"), "runs"],
  ];
  for (const [src, dst, label] of pairs) {
    if (moveMerge(src, dst)) moved.push(label);
  }
  return moved;
}

export function listIterations(root, cfg) {
  const dir = paths(root, cfg).iterations;
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
