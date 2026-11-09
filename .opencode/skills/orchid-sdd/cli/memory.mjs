import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { parseFrontMatter } from "./yaml.mjs";
import {
  appendEvent,
  checkProjection,
  loadManifest,
  loadRecallIndexFresh,
  paths,
  readState,
  writeProjection,
  writeState,
} from "./store.mjs";
import {
  OrchidError,
  exists,
  formatJson,
  isUuid7,
  rel,
  sha256File,
  splitCommas,
  splitSemicolons,
  tokenize,
  uuid7,
  walkFiles,
} from "./util.mjs";
import { formatLedgerErrors, parseRelatedIds, readLedger } from "./dependencies.mjs";

export const NODE_TYPES = new Set([
  "Requirement",
  "Scenario",
  "Question",
  "Answer",
  "Decision",
  "ADR",
  "Prompt",
  "Run",
  "Review",
  "Finding",
  "CodeUnit",
  "Message",
  "AuditArchive",
  "Release",
  "Assumption",
  "Test",
]);

function context(root) {
  const loaded = loadConfig(root);
  const state = readState(root);
  return { config: loaded.config, hash: loaded.hash, state };
}

export function newUuid() {
  process.stdout.write(`${uuid7()}\n`);
  return 0;
}

export function record(root, args) {
  const { config, state } = context(root);
  const type = args.type;
  if (!type || !NODE_TYPES.has(type)) {
    throw new OrchidError(`--type must be one of: ${[...NODE_TYPES].join(", ")}`);
  }
  const description = String(args.description || "").trim();
  if (!description) throw new OrchidError("--description is required");
  if (description.length > 160) {
    throw new OrchidError(`--description must be at most 160 characters (got ${description.length})`);
  }
  const topics = splitCommas(args.topics);
  if (topics.length < 3 || topics.length > 7) {
    throw new OrchidError("--topics must contain 3 to 7 comma-separated tags");
  }
  const scope = args.scope === "project" ? "project" : "iteration";
  const iteration = scope === "project" ? null : args.iteration || state.activeIteration;
  if (scope === "iteration" && !iteration) {
    throw new OrchidError("no active iteration; run `orchid-sdd start` first or use --scope project");
  }
  const repo = args.repo ? String(args.repo) : null;
  if (repo) {
    const known = ((config.workspace && config.workspace.repos) || []).some(
      (entry) => entry.id === repo && entry.enabled !== false,
    );
    if (!known) throw new OrchidError(`unknown or disabled workspace repo "${repo}"`);
  }

  let rawId = String(args.id || uuid7()).replace(/^urn:uuid:/, "");
  if (!isUuid7(rawId)) throw new OrchidError(`memory id must be a UUIDv7: ${rawId}`);
  const id = `urn:uuid:${rawId}`;

  const questions = splitSemicolons(args.questions);
  const aliases = Array.isArray(args.alias) ? args.alias : args.alias ? [args.alias] : [];
  const relationArgs = Array.isArray(args.relation) ? args.relation : args.relation ? [args.relation] : [];
  const relations = relationArgs.map((entry) => {
    const at = entry.indexOf(":");
    if (at < 1) throw new OrchidError(`invalid --relation "${entry}" (expected predicate:target)`);
    return { predicate: entry.slice(0, at), target: entry.slice(at + 1) };
  });

  let artifact = args.artifact ? String(args.artifact).replace(/\\/g, "/") : null;
  let hash = null;
  if (artifact) {
    const candidates = path.isAbsolute(artifact)
      ? [artifact]
      : [
          ...(iteration
            ? [path.join(paths(root, config).iterations, iteration, artifact)]
            : []),
          path.join(root, artifact),
        ];
    const found = candidates.find((file) => fs.existsSync(file));
    if (found) hash = sha256File(found);
  }

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const node = {
    "@id": id,
    "@type": `orchid:${type}`,
    description,
    status: args.status || "accepted",
    topics,
    provenance: {
      phase: state.phase,
      persona: args.actor || "orchestrator",
      run: null,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    iteration,
    scope,
  };
  if (questions.length) node.answers = questions;
  if (aliases.length) node.aliases = aliases;
  if (relations.length) node.relations = relations;
  if (artifact) node.artifact = artifact;
  if (args.code) node.codeAnchor = String(args.code);
  if (repo) node.repo = repo;
  if (hash) node.hash = hash;

  appendEvent(root, config, state, {
    type: "node.recorded",
    subject: id,
    payload: { node },
    actor: args.actor || "orchestrator",
  });
  writeProjection(root, config, state);
  writeState(root, state);

  if (args.json) {
    process.stdout.write(`${formatJson(node)}\n`);
  } else {
    process.stdout.write(`Recorded ${id} (${type})\n`);
    process.stdout.write(`  ${description}\n`);
    process.stdout.write(
      `  ${scope === "project" ? "scope project" : `iteration ${iteration}`}\n`,
    );
  }
  return 0;
}

export function index(root, args) {
  const { config, state } = context(root);
  if (args.check) {
    const ledger = readLedger(root, config);
    if (ledger.errors.length) {
      process.stdout.write(
        `Cross-repo dependency ledger is invalid (.orchid/cross-repo-dependencies.md):\n${formatLedgerErrors(ledger)}\n`,
      );
      return 1;
    }
    const drift = checkProjection(root, config, state);
    if (drift.length) {
      process.stdout.write(`Projection is stale:\n${drift.map((item) => `  - ${item}`).join("\n")}\n`);
      process.stdout.write("Run `orchid-sdd index` to rebuild.\n");
      return 1;
    }
    process.stdout.write("Projection is up to date.\n");
    return 0;
  }
  const ledger = readLedger(root, config);
  if (ledger.errors.length) {
    throw new OrchidError(
      `invalid cross-repo dependency ledger (.orchid/cross-repo-dependencies.md):\n${formatLedgerErrors(ledger)}`,
    );
  }
  const { manifest, indexes } = writeProjection(root, config, state, { recall: true });
  if (args.json) {
    process.stdout.write(
      `${formatJson({
        iteration: manifest.iteration ? manifest.iteration["@id"] : null,
        nodes: manifest.nodes.length,
        history: manifest.history.length,
        indexes: Object.keys(indexes),
      })}\n`,
    );
    return 0;
  }
  const label = manifest.iteration ? manifest.iteration.title : "no active iteration";
  process.stdout.write(`Indexed ${manifest.nodes.length} node(s) for ${label}\n`);
  process.stdout.write(`  manifest ${paths(root, config).manifest}\n`);
  process.stdout.write(`  indexes  ${Object.keys(indexes).length} files\n`);
  return 0;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeRef(value) {
  return String(value || "").replace(/^urn:uuid:/, "").toLowerCase();
}

// Identifier-like queries (UUIDs and code IDs like DEP-001, R-001, ADR-012) are
// matched exactly only: their numeric/hex suffix must never fall through to the
// token-overlap fallback, which would spuriously match unrelated R-001 nodes.
const IDENTIFIER_QUERY_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z]+-\d+)$/;

function dependencyRepos(row) {
  return [row.Consumer, row.Provider]
    .map((value) => String(value || "").split("/")[0].trim().toLowerCase())
    .filter(Boolean);
}

function scoreDependency(row, queryLower, tokens, isIdentifier) {
  const id = String(row.ID || "").toLowerCase();
  const contract = String(row.Contract || "").toLowerCase();
  const consumer = String(row.Consumer || "").toLowerCase();
  const provider = String(row.Provider || "").toLowerCase();
  const owner = String(row.Owner || "").toLowerCase();

  if (id === queryLower) return 100;
  if (contract === queryLower) return 80;
  if (dependencyRepos(row).includes(queryLower)) return 70;

  // Identifier queries do not use token overlap for rows either.
  if (isIdentifier) return 0;

  if (tokens.length) {
    const tokenSet = new Set(tokenize([id, contract, consumer, provider, owner].join(" ")));
    let matched = 0;
    for (const token of tokens) if (tokenSet.has(token)) matched += 1;
    if (matched > 0) return 10 * matched;
  }
  return 0;
}

function sortNodes(items) {
  return items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const createdA = String(a.node.createdAt || "");
    const createdB = String(b.node.createdAt || "");
    if (createdA !== createdB) return createdA > createdB ? -1 : 1;
    const idA = a.node["@id"] || a.node.id;
    const idB = b.node["@id"] || b.node.id;
    return idA > idB ? -1 : 1;
  });
}

function sortDependencies(items) {
  return items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.row.ID).localeCompare(String(b.row.ID));
  });
}

const RECENT_HISTORY_WINDOW = 3;
const HISTORY_MODES = new Set(["recent", "all", "none"]);

function summarizeEntry(entry, score, why) {
  return {
    id: entry.id,
    type: entry.type,
    description: entry.description,
    artifact: entry.artifact,
    score,
    why,
    iteration: entry.iteration,
    scope: entry.scope,
    supersededBy: entry.supersededBy,
  };
}

/**
 * Score a compact index entry. Base tiers mirror the full-node matcher; on top of
 * that, active/project/last-closed nodes get a boost and superseded nodes are
 * downranked. Returns `{ score, why }` so summary output can explain the match.
 */
function rankNode(entry, queryLower, tokens, isIdentifier, rankCtx) {
  const id = normalizeRef(entry.id);
  const aliases = (entry.aliases || []).map((value) => String(value).toLowerCase());
  const topics = (entry.topics || []).map((value) => String(value).toLowerCase());
  const answers = (entry.questions || []).map((value) => String(value).toLowerCase());
  const code = String(entry.codeAnchor || "").toLowerCase();
  const description = String(entry.description || "").toLowerCase();

  let base = 0;
  let why = null;
  if (id === queryLower) {
    base = 100;
    why = "id";
  } else if (aliases.includes(queryLower)) {
    base = 100;
    why = "alias";
  } else if (topics.includes(queryLower)) {
    base = 80;
    why = "topic";
  } else if (code && code === queryLower) {
    base = 70;
    why = "code anchor";
  } else if (description.includes(queryLower) || answers.some((value) => value.includes(queryLower))) {
    base = 60;
    why = "phrase";
  } else if (!isIdentifier && tokens.length) {
    const tokenSet = new Set(
      tokenize([id, ...aliases, ...topics, ...answers, code, description].join(" ")),
    );
    let matched = 0;
    for (const token of tokens) if (tokenSet.has(token)) matched += 1;
    if (matched === tokens.length) {
      base = 40 + 5 * matched;
      why = "tokens";
    } else if (matched > 0) {
      base = 10;
      why = "partial";
    }
  }

  if (base === 0) return { score: 0, why: null, base: 0 };

  let score = base;
  const active = entry.snapshot === null;
  const project = entry.scope === "project";
  const lastClosed = entry.snapshot !== null && entry.snapshot === rankCtx.lastClosedSnapshot;
  if (active) score += 20;
  if (project) score += 15;
  if (lastClosed) score += 10;
  if (entry.supersededBy) score -= 50;

  return { score, why, base };
}

/**
 * Collect the ids of nodes reachable within `hops` hops from `seedIds`, following
 * forward and reverse relations over the compact index (no hydration). The reverse
 * pass uses the precomputed `incomingRelations` map so it is O(degree), not O(nodes).
 */
function collectRelatedIds(incomingRelations, nodesById, resolveId, seedIds, hops, relatedSeen, relatedIds) {
  let frontier = [...seedIds];
  for (let hop = 0; hop < hops; hop += 1) {
    const next = [];
    for (const nodeId of frontier) {
      const entry = nodesById.get(nodeId);
      for (const relation of entry?.relations || []) {
        const targetId = resolveId(relation.target);
        if (targetId && !relatedSeen.has(targetId)) {
          relatedSeen.add(targetId);
          relatedIds.push(targetId);
          next.push(targetId);
        }
      }
      for (const sourceId of incomingRelations[nodeId] || []) {
        if (!relatedSeen.has(sourceId)) {
          relatedSeen.add(sourceId);
          relatedIds.push(sourceId);
          next.push(sourceId);
        }
      }
    }
    frontier = next;
  }
}

function renderSummaryLine(entry, score, why) {
  const type = entry.type ? String(entry.type).replace(/^orchid:/, "") : "memory";
  const aliases = (entry.aliases || []).length ? ` [${entry.aliases.join(", ")}]` : "";
  const description = String(entry.description || "").slice(0, 120);
  const scorePart = score != null ? ` (${why || "match"}, ${score})` : ` (${why || "related"})`;
  return `- ${type}${aliases} ${entry.id} — ${description}${scorePart}`;
}

function applyBudget(query, matches, related, dependencies, unresolved, budget) {
  if (!Number.isInteger(budget) || budget <= 0) return matches;
  let result = matches;
  // Drop the lowest-ranked matches until the whole serialized payload fits, always
  // keeping at least one match. related/dependencies/unresolved are not ranked and
  // are kept; when they alone exceed the budget the limit is best-effort.
  while (result.length > 1) {
    const size = Buffer.byteLength(
      formatJson({ query, matches: result, dependencies, related, unresolved }),
    );
    if (size <= budget) break;
    result = result.slice(0, -1);
  }
  return result;
}

function renderNode(node, resolveRef) {
  const lines = [`## ${node["@id"]} — ${node["@type"] || "memory"}`, "", node.description || ""];
  if (node.artifact) lines.push("", `- artifact: \`${node.artifact}\``);
  if (node.codeAnchor) lines.push(`- code: \`${node.codeAnchor}\``);
  if (node.topics && node.topics.length) lines.push(`- topics: ${node.topics.join(", ")}`);
  if (node.answers && node.answers.length) {
    lines.push(`- answers: ${node.answers.map((q) => `"${q}"`).join("; ")}`);
  }
  for (const relation of node.relations || []) {
    const target = resolveRef(relation.target);
    lines.push(`- ${relation.predicate} → ${relation.target}${target ? ` (${target.description})` : ""}`);
  }
  return lines.join("\n");
}

function renderDependency(row, resolveRef) {
  const contract = row.Version ? `${row.Contract} ${row.Version}` : row.Contract;
  const lines = [`## ${row.ID} — dependency`, ""];
  lines.push(`- kind: ${row.Kind || ""}`);
  lines.push(`- consumer: ${row.Consumer || ""}`);
  lines.push(`- provider: ${row.Provider || ""}`);
  lines.push(`- contract: ${contract || ""}`);
  lines.push(`- status: ${row.Status || ""}`);
  if (row["Last verified"]) lines.push(`- last verified: ${row["Last verified"]}`);
  const related = parseRelatedIds(row.Related).map((ref) => {
    const node = resolveRef(ref);
    return node ? `${ref} (${node.description})` : ref;
  });
  if (related.length) lines.push(`- related: ${related.join(", ")}`);
  return lines.join("\n");
}

export function recall(root, args) {
  const { config, state } = context(root);

  const query = String(args.query || "").trim();
  if (!query) throw new OrchidError("recall requires a uuid, topic, question, or path");
  const queryLower = normalizeRef(query);
  const tokens = tokenize(query);
  const isIdentifier = IDENTIFIER_QUERY_RE.test(queryLower);
  const rawLimit = Number.parseInt(String(args.limit ?? ""), 10);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const historyMode = String(args.history || "recent");
  if (!HISTORY_MODES.has(historyMode)) {
    throw new OrchidError(`--history must be one of: ${[...HISTORY_MODES].join(", ")}`);
  }
  const includeSuperseded = args.includeSuperseded === true;
  const summaryMode = args.summary === true && !args.full;
  const budget = Number.parseInt(String(args.budget ?? ""), 10);

  const ledger = readLedger(root, config);
  if (ledger.errors.length) {
    throw new OrchidError(
      `invalid cross-repo dependency ledger (.orchid/cross-repo-dependencies.md):\n${formatLedgerErrors(ledger)}`,
    );
  }

  // Load the manifest and the generated recall index exactly once (rebuilding the
  // index lazily only when it is missing or stale).
  const manifest = loadManifest(root, config);
  const index = loadRecallIndexFresh(root, config, state);

  const nodesById = new Map(index.nodes.map((entry) => [entry.id, entry]));
  const nodesByNormId = new Map(index.nodes.map((entry) => [normalizeRef(entry.id), entry.id]));

  const snapshotRank = new Map();
  index.history.forEach((entry, i) => snapshotRank.set(entry.snapshot, i));
  const rankCtx = {
    snapshotRank,
    lastClosedSnapshot: index.history.length ? index.history[index.history.length - 1].snapshot : null,
  };

  const activeById = new Map((manifest.nodes || []).map((node) => [node["@id"], node]));
  const snapshotCache = new Map();
  let hydratedSnapshots = 0;
  let hydratedNodes = 0;
  function hydrate(id) {
    if (activeById.has(id)) return activeById.get(id);
    const entry = nodesById.get(id);
    if (!entry || !entry.snapshot) return null;
    if (!snapshotCache.has(entry.snapshot)) {
      hydratedSnapshots += 1;
      const file = path.join(paths(root, config).knowledge, entry.snapshot);
      let byId = new Map();
      try {
        byId = new Map(
          (JSON.parse(fs.readFileSync(file, "utf8")).nodes || []).map((node) => [node["@id"], node]),
        );
      } catch {
        byId = new Map();
      }
      snapshotCache.set(entry.snapshot, byId);
    }
    const node = snapshotCache.get(entry.snapshot).get(id);
    if (node) hydratedNodes += 1;
    return node || null;
  }

  function reportStats() {
    if (process.env.ORCHID_RECALL_STATS === "1") {
      process.stderr.write(
        `recall-stats snapshots=${hydratedSnapshots} nodes=${hydratedNodes}\n`,
      );
    }
  }

  const snapshotIteration = (snapshot) => {
    const match = /^iterations\/([^/]+)\//.exec(snapshot || "");
    return match ? match[1] : null;
  };

  function pickMostRecent(ids) {
    let best = null;
    let bestRank = -Infinity;
    let bestCreated = "";
    let bestId = "";
    for (const id of ids) {
      const entry = nodesById.get(id);
      if (!entry) continue;
      const rank =
        entry.snapshot === null ? snapshotRank.size : (snapshotRank.get(entry.snapshot) ?? -1);
      const created = entry.createdAt || "";
      if (
        rank > bestRank ||
        (rank === bestRank && (created > bestCreated || (created === bestCreated && id > bestId)))
      ) {
        best = id;
        bestRank = rank;
        bestCreated = created;
        bestId = id;
      }
    }
    return best;
  }

  function resolveId(target) {
    if (!target) return null;
    const raw = String(target);
    const key = normalizeRef(raw);
    const exactId = nodesByNormId.get(key) || (nodesById.has(raw) ? raw : null);
    if (exactId) return exactId;

    const at = raw.indexOf("@");
    if (at > 0) {
      const alias = raw.slice(0, at).toLowerCase();
      const iteration = raw.slice(at + 1);
      for (const id of index.aliasesIndex[alias] || []) {
        const entry = nodesById.get(id);
        if (entry && (entry.iteration === iteration || snapshotIteration(entry.snapshot) === iteration)) {
          return id;
        }
      }
      return null;
    }

    return pickMostRecent(index.aliasesIndex[key] || []);
  }

  // Exact id/alias/UUID lookups bypass the history window and search all history.
  const isExactRef =
    nodesByNormId.has(queryLower) ||
    Boolean(index.aliasesIndex[queryLower] && index.aliasesIndex[queryLower].length);
  const searchAll = isIdentifier || isExactRef || historyMode === "all";

  const allowedSnapshots = new Set();
  if (args.iteration) {
    for (const entry of index.history) {
      if (entry.iteration === args.iteration) allowedSnapshots.add(entry.snapshot);
    }
  } else if (historyMode === "recent") {
    for (const entry of index.history.slice(-RECENT_HISTORY_WINDOW)) {
      allowedSnapshots.add(entry.snapshot);
    }
  }

  function inScope(entry) {
    if (searchAll) return true;
    if (entry.snapshot === null) return true;
    return allowedSnapshots.has(entry.snapshot);
  }

  // Union of exact + token postings; never an exclusive shortlist.
  const candidateIds = new Set();
  const add = (list) => {
    if (list) for (const id of list) candidateIds.add(id);
  };
  const exactId = nodesByNormId.get(queryLower);
  if (exactId) candidateIds.add(exactId);
  add(index.aliasesIndex[queryLower]);
  add(index.topicsIndex[queryLower]);
  add(index.questionsIndex[queryLower]);
  add(index.codeAnchorsIndex[queryLower]);
  // Identifier queries resolve exact maps only; the token postings would only add
  // candidates that rankNode then discards.
  if (!isIdentifier) {
    for (const token of tokens) add(index.terms[token]);
  }

  const matched = [];
  for (const id of candidateIds) {
    const entry = nodesById.get(id);
    if (!entry) continue;
    if (!inScope(entry)) continue;
    if (args.repo && entry.repo !== args.repo) continue;
    if (!includeSuperseded && entry.supersededBy) continue;
    const { score, why, base } = rankNode(entry, queryLower, tokens, isIdentifier, rankCtx);
    if (base > 0) matched.push({ score, why, node: entry });
  }
  sortNodes(matched);

  const matchedDeps = [];
  for (const row of ledger.rows) {
    if (args.repo && !dependencyRepos(row).includes(String(args.repo).toLowerCase())) continue;
    const score = scoreDependency(row, queryLower, tokens, isIdentifier);
    if (score > 0) matchedDeps.push({ score, row });
  }
  sortDependencies(matchedDeps);

  const topEntries = matched.slice(0, limit);
  const dependencies = matchedDeps.slice(0, limit).map((item) => item.row);

  if (!topEntries.length && !dependencies.length) {
    if (args.json) {
      process.stdout.write(
        `${formatJson({ query, matches: [], dependencies: [], related: [], unresolved: [] })}\n`,
      );
    } else {
      process.stdout.write(`No memory found for "${query}".\n`);
    }
    return 0;
  }

  const hops = Math.min(Math.max(Number.parseInt(args.hops || "1", 10) || 1, 1), 2);

  const matchIds = topEntries.map((item) => item.node.id);
  const relatedIds = [];
  const relatedSeen = new Set(matchIds);
  const unresolved = [];
  const depSeeds = [];
  for (const row of dependencies) {
    for (const ref of parseRelatedIds(row.Related)) {
      const id = resolveId(ref);
      if (id) {
        if (!relatedSeen.has(id)) {
          relatedSeen.add(id);
          relatedIds.push(id);
          depSeeds.push(id);
        }
      } else {
        unresolved.push(ref);
      }
    }
  }

  collectRelatedIds(index.incomingRelations, nodesById, resolveId, matchIds, hops, relatedSeen, relatedIds);
  collectRelatedIds(index.incomingRelations, nodesById, resolveId, depSeeds, hops, relatedSeen, relatedIds);

  const resolveEntry = (target) => {
    const id = resolveId(target);
    return id ? nodesById.get(id) : null;
  };
  const resolveNode = (target) => {
    const id = resolveId(target);
    return id ? hydrate(id) : null;
  };

  const matches = topEntries.map((item) =>
    summaryMode ? summarizeEntry(item.node, item.score, item.why) : hydrate(item.node.id),
  );
  const related = relatedIds.map((id) => {
    const entry = nodesById.get(id);
    if (!entry) return null;
    return summaryMode ? summarizeEntry(entry, null, "related") : hydrate(id);
  });

  const finalMatches =
    summaryMode && Number.isInteger(budget) && budget > 0
      ? applyBudget(query, matches, related, dependencies, unresolved, budget)
      : matches;

  if (args.json) {
    process.stdout.write(
      `${formatJson({ query, matches: finalMatches, dependencies, related, unresolved })}\n`,
    );
    reportStats();
    return 0;
  }

  process.stdout.write(`# Recall: ${query}\n\n`);
  if (summaryMode) {
    for (const item of finalMatches) {
      const entry = nodesById.get(item.id);
      process.stdout.write(`${renderSummaryLine(entry, item.score, item.why)}\n`);
    }
    for (const row of dependencies) process.stdout.write(`${renderDependency(row, resolveEntry)}\n\n`);
    if (related.length) {
      process.stdout.write(`## Related (${hops} hop${hops > 1 ? "s" : ""})\n`);
      for (const item of related) {
        const entry = nodesById.get(item.id);
        process.stdout.write(`${renderSummaryLine(entry, null, "related")}\n`);
      }
    }
    if (unresolved.length) {
      process.stdout.write(`## Unresolved\n`);
      for (const ref of unresolved) process.stdout.write(`- ${ref}\n`);
    }
    reportStats();
    return 0;
  }

  for (const node of matches) {
    if (node) process.stdout.write(`${renderNode(node, resolveNode)}\n\n`);
  }
  for (const row of dependencies) process.stdout.write(`${renderDependency(row, resolveNode)}\n\n`);
  if (related.length) {
    process.stdout.write(`## Related (${hops} hop${hops > 1 ? "s" : ""})\n\n`);
    for (const node of related) {
      if (node) process.stdout.write(`${renderNode(node, resolveNode)}\n\n`);
    }
  }
  if (unresolved.length) {
    process.stdout.write(`## Unresolved\n\n`);
    for (const ref of unresolved) process.stdout.write(`- ${ref}\n`);
  }
  reportStats();
  return 0;
}

const CODE_EXTS = [
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java",
  ".kt", ".rb", ".php", ".cs", ".swift", ".scala", ".sql", ".sh", ".bash", ".yaml", ".yml",
];
const EXCLUDES = [
  ".git", "node_modules", ".knowledge", ".orchid", "dist", "build", "target",
  "vendor", "coverage", ".venv", "venv", "__pycache__", ".next",
  ".pytest_cache", ".ruff_cache", ".serena", ".orchid-migration-bck",
];

export function lint(root, args) {
  const { config } = context(root);
  const manifest = loadManifest(root, config);
  const nodes = [...manifest.nodes];
  for (const entry of manifest.history || []) {
    if (!entry.manifest) continue;
    const file = path.join(paths(root, config).knowledge, entry.manifest);
    if (fs.existsSync(file)) {
      try {
        nodes.push(...(JSON.parse(fs.readFileSync(file, "utf8")).nodes || []));
      } catch {
        /* doctor reports unreadable history */
      }
    }
  }

  const errors = [];
  const warnings = [];
  const anchors = new Map();
  const maxComment = Number(config.docblocks.max_behavior_comment_chars) || 500;

  for (const file of walkFiles(root, CODE_EXTS, EXCLUDES)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/ORCHID-MEM:\s*[0-9a-f-]{36}/i.test(trimmed)) {
        const re = /ORCHID-MEM:\s*([0-9a-f-]{36})/gi;
        const hasDescription = /ORCHID-MEM:\s*[0-9a-f-]{36}\s+[—–-]\s+\S+/i.test(trimmed);
        let match;
        while ((match = re.exec(line))) {
          const uuid = match[1].toLowerCase();
          if (!isUuid7(uuid)) errors.push(`${rel(root, file)}:${index + 1}: anchor is not a UUIDv7: ${uuid}`);
          if (!anchors.has(uuid)) anchors.set(uuid, []);
          anchors.get(uuid).push({ file, line: index + 1 });
        }
        if (!hasDescription) {
          errors.push(
            `${rel(root, file)}:${index + 1}: anchor is missing a short description (expected "ORCHID-MEM: <uuid> — <description>")`,
          );
        }
        if (trimmed.length > 180) {
          warnings.push(`${rel(root, file)}:${index + 1}: anchor line is longer than 180 characters`);
        }
      } else if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
        const body = trimmed.replace(/^(\/\/|#|--)\s?/, "");
        if (body.length > maxComment) {
          errors.push(`${rel(root, file)}:${index + 1}: comment is ${body.length} chars (max ${maxComment})`);
        }
      }
    });
  }

  const docblocks = new Map();
  if (exists(paths(root, config).docblocks)) {
    for (const file of walkFiles(paths(root, config).docblocks, [".md"], [])) {
      let data;
      let body;
      try {
        const parsed = parseFrontMatter(fs.readFileSync(file, "utf8"));
        data = parsed.data;
        body = parsed.body;
      } catch (error) {
        errors.push(`${rel(root, file)}: invalid front matter: ${error.message}`);
        continue;
      }
      if (!data.memory) continue;
      const uuid = String(data.memory).toLowerCase();
      if (!isUuid7(uuid)) errors.push(`${rel(root, file)}: memory is not a UUIDv7: ${uuid}`);
      if (docblocks.has(uuid)) errors.push(`${rel(root, file)}: duplicate docblock memory ${uuid}`);
      docblocks.set(uuid, { file, data, body });
    }
  }

  const codeUnits = new Set(
    nodes
      .filter((node) => node["@type"] === "orchid:CodeUnit")
      .map((node) => node["@id"].replace(/^urn:uuid:/, "").toLowerCase()),
  );

  for (const [uuid, locations] of anchors) {
    if (locations.length > 1) {
      errors.push(`duplicate anchor ${uuid}: ${locations.map((item) => `${rel(root, item.file)}:${item.line}`).join(", ")}`);
    }
    if (!codeUnits.has(uuid)) {
      errors.push(`anchor ${uuid} has no CodeUnit node; record one with \`orchid-sdd record --type CodeUnit\``);
    }
    if (config.docblocks.require_docblock_for_anchor && !docblocks.has(uuid)) {
      errors.push(`anchor ${uuid} has no docblock at ${config.docblocks_folder}/<uuid>.md`);
    }
  }

  for (const [uuid, item] of docblocks) {
    const code = String(item.data.code || "");
    if (!code) {
      errors.push(`${rel(root, item.file)}: docblock is missing 'code:'`);
      continue;
    }
    const target = code.split("#")[0];
    if (!fs.existsSync(path.join(root, target))) {
      errors.push(`${rel(root, item.file)}: code target does not exist: ${target}`);
    }
    const history = String(item.body || "").match(/^#{1,6}\s+History\s*$/im);
    if (!history) {
      errors.push(`${rel(root, item.file)}: docblock is missing a History section`);
    } else {
      const after = String(item.body || "").slice(history.index + history[0].length);
      const section = after.split(/^#{1,6}\s+/m)[0].trim();
      if (!section) errors.push(`${rel(root, item.file)}: docblock History is empty`);
    }
    if (!anchors.has(uuid)) {
      errors.push(`${rel(root, item.file)}: no ORCHID-MEM anchor found for ${uuid}`);
    }
    if (!codeUnits.has(uuid)) {
      errors.push(`${rel(root, item.file)}: no CodeUnit node for ${uuid}`);
    }
  }

  for (const uuid of codeUnits) {
    if (!anchors.has(uuid)) warnings.push(`CodeUnit ${uuid} has no anchor in code`);
  }

  const result = { errors, warnings, anchors: anchors.size, docblocks: docblocks.size, nodes: nodes.length };
  if (args.json) {
    process.stdout.write(`${formatJson(result)}\n`);
    return errors.length ? 1 : 0;
  }
  process.stdout.write(`Lint: ${anchors.size} anchor(s), ${docblocks.size} docblock(s), ${nodes.length} node(s)\n`);
  for (const message of errors) process.stdout.write(`  [error] ${message}\n`);
  for (const message of warnings) process.stdout.write(`  [warn]  ${message}\n`);
  process.stdout.write(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
  return errors.length ? 1 : 0;
}
