import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.mjs";
import { loadPersonas, validatePersonaRefs } from "./registry.mjs";
import { loadSteering, validateSteeringRefs } from "./steering.mjs";
import { validateWorkspace } from "./workspace.mjs";
import { CONTEXT } from "./setup.mjs";
import { checkProjection, loadManifestNodes, paths, readState, recallIndexProblem, writeProjection } from "./store.mjs";
import { ensureDir, exists, formatJson, readJson, writeJson } from "./util.mjs";
import { LEDGER_FILE, formatLedgerDiagnostic, parseRelatedIds, readLedger } from "./dependencies.mjs";

export function runDoctor(root, skillRoot, options = {}) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const fixes = [];
  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);
  const info = (message) => infos.push(message);

  const loaded = loadConfig(root, { required: false });
  if (!loaded) {
    fail("orchid-sdd.yml is missing; run `orchid-sdd setup`");
    return finish({ errors, warnings, infos, fixes }, options);
  }
  const { config, hash } = loaded;
  if (config.version !== 1) fail(`config version ${config.version} is not supported`);
  const p = paths(root, config);

  for (const required of [
    path.join(skillRoot, ".skill", "personas"),
    path.join(skillRoot, ".skill", "steering"),
    path.join(skillRoot, ".skill", "constitution"),
    path.join(skillRoot, ".skill", "templates", "profiles"),
  ]) {
    if (!exists(required)) fail(`skill package is incomplete: missing ${required}`);
  }

  for (const [label, dir] of [
    ["knowledge", p.knowledge],
    ["docblocks", p.docblocks],
    ["constitution", p.constitution],
    ["customizations", p.customizations],
    ["steering", p.steering],
  ]) {
    if (!exists(dir)) {
      if (options.fix) {
        ensureDir(dir);
        fixes.push(`created ${label} folder`);
      } else {
        fail(`${label} folder is missing: ${dir} (use --fix)`);
      }
    }
  }

  let state = null;
  if (!exists(p.state)) {
    fail(".orchid/state.json is missing; run `orchid-sdd setup`");
  } else {
    try {
      state = readState(root);
      if (state.schemaVersion !== 1) fail(`state schemaVersion ${state.schemaVersion} is not supported`);
      if (state.configHash && state.configHash !== hash) {
        warn("state.configHash does not match the effective config; run `orchid-sdd resume --fix` or `doctor --fix`");
        if (options.fix) {
          state.configHash = hash;
          writeJson(p.state, state);
          fixes.push("updated state.configHash");
        }
      }
      if (state.gates && state.gates.G0 !== "passed") warn("gate G0 is not passed");
    } catch (error) {
      fail(`cannot read state: ${error.message}`);
    }
  }

  if (!exists(p.manifest)) {
    if (options.fix && state) {
      try {
        writeProjection(root, config, state, { recall: true });
        fixes.push("rebuilt manifest and indexes");
      } catch (error) {
        fail(`cannot rebuild projection: ${error.message}`);
      }
    } else {
      fail("manifest.jsonld is missing; run `orchid-sdd index`");
    }
  } else {
    try {
      const manifest = readJson(p.manifest);
      if (!manifest.schemaVersion) warn("manifest has no schemaVersion");
      if (state && state.activeIteration && manifest.iteration === null) {
        warn("manifest has no iteration while state has an active iteration; run `orchid-sdd index`");
      }
    } catch (error) {
      fail(`cannot read manifest: ${error.message}`);
    }
  }

  if (!exists(path.join(p.context, "orchid-v1.jsonld"))) {
    if (options.fix) {
      writeJson(path.join(p.context, "orchid-v1.jsonld"), CONTEXT);
      fixes.push("wrote pinned JSON-LD context");
    } else {
      warn("pinned JSON-LD context is missing (use --fix)");
    }
  }

  let personaMap = null;
  try {
    personaMap = loadPersonas(skillRoot, root, config);
    const personaErrors = validatePersonaRefs(config, personaMap);
    for (const message of personaErrors) fail(message);
  } catch (error) {
    fail(error.message);
  }
  try {
    const steeringMap = loadSteering(skillRoot, root, config);
    const steeringErrors = validateSteeringRefs(config, steeringMap);
    for (const message of steeringErrors) fail(message);
    info(`steering: ${config.steering.enabled.length} enabled rule(s)`);
  } catch (error) {
    fail(error.message);
  }
  if (personaMap) {
    const workspace = validateWorkspace(root, config, personaMap);
    for (const message of workspace.errors) fail(message);
    for (const message of workspace.warnings) warn(message);
    if (config.workspace && config.workspace.enabled) {
      info(`workspace: ${workspace.repos.length} enabled repo(s)`);
    }
  }

  const ledger = readLedger(root, config);
  if (ledger.workspaceEnabled && !ledger.present) {
    warn(`cross-repo dependency ledger is missing: ${LEDGER_FILE}`);
  }
  for (const error of ledger.errors) {
    fail(`cross-repo dependency ledger: ${formatLedgerDiagnostic(error)}`);
  }
  for (const warning of ledger.warnings) {
    warn(`cross-repo dependency ledger: ${formatLedgerDiagnostic(warning)}`);
  }
  if (ledger.present) {
    info(`dependencies: ${ledger.rows.length} row(s)`);
  }

  if (exists(p.manifest)) {
    try {
      const { active, history } = loadManifestNodes(root, config);
      const byId = new Map();
      const allNodes = [];
      for (const node of active) {
        byId.set(node["@id"], node);
        allNodes.push(node);
      }
      for (const node of history) {
        if (!byId.has(node["@id"])) {
          byId.set(node["@id"], node);
          allNodes.push(node);
        }
      }

      const isProject = (node) =>
        node.scope === "project" || node.iteration === null || node.iteration === "project";

      // Alias uniqueness: project-scoped aliases are globally unique; iteration-scoped
      // aliases are unique only within the active iteration. Historical iteration-scoped
      // nodes do not participate.
      const projectNodes = [];
      const iterationNodes = [];
      for (const node of active) (isProject(node) ? projectNodes : iterationNodes).push(node);
      const activeIds = new Set(active.map((node) => node["@id"]));
      for (const node of history) {
        if (isProject(node) && !activeIds.has(node["@id"])) {
          projectNodes.push(node);
          activeIds.add(node["@id"]);
        }
      }

      const byRef = new Map();
      const nodesByAlias = new Map();
      for (const node of allNodes) {
        byRef.set(node["@id"], node);
        for (const alias of node.aliases || []) {
          const key = String(alias).toLowerCase();
          if (!byRef.has(key)) byRef.set(key, node);
          if (!nodesByAlias.has(key)) nodesByAlias.set(key, []);
          nodesByAlias.get(key).push(node);
        }
      }

      // Resolve the same forms as recall: exact @id, exact alias, then
      // alias@iteration for a pinned historical node.
      const resolveRef = (ref) => {
        const raw = String(ref || "");
        if (!raw) return null;
        if (byRef.has(raw)) return byRef.get(raw);
        const lower = raw.toLowerCase();
        if (byRef.has(lower)) return byRef.get(lower);
        const at = raw.indexOf("@");
        if (at > 0) {
          const alias = raw.slice(0, at).toLowerCase();
          const iteration = raw.slice(at + 1);
          return (nodesByAlias.get(alias) || []).find((node) => node.iteration === iteration) || null;
        }
        return null;
      };

      const checkAliases = (nodes, label) => {
        const owners = new Map();
        for (const node of nodes) {
          for (const alias of node.aliases || []) {
            const key = String(alias).toLowerCase();
            if (!owners.has(key)) owners.set(key, new Set());
            owners.get(key).add(node["@id"]);
          }
        }
        for (const [alias, set] of owners) {
          if (set.size > 1) {
            fail(`duplicate ${label} alias "${alias}" on nodes: ${[...set].join(", ")}`);
          }
        }
      };
      checkAliases(projectNodes, "project-scoped");
      checkAliases(iterationNodes, "iteration-scoped");

      const projectTypes = new Set(["orchid:Decision", "orchid:ADR", "orchid:Requirement"]);
      for (const node of allNodes) {
        for (const relation of node.relations || []) {
          const target = relation.target;
          if (target && !resolveRef(target)) {
            fail(`relation "${relation.predicate}" from ${node["@id"]} targets unresolved "${target}"`);
          }
        }
        if (isProject(node) && projectTypes.has(node["@type"]) && !node.artifact) {
          warn(`project-scoped ${String(node["@type"]).replace(/^orchid:/, "")} ${node["@id"]} has no artifact`);
        }
        if (!node.topics || node.topics.length === 0) {
          warn(`node ${node["@id"]} has no topics`);
        }
        if (!node.description || !String(node.description).trim()) {
          warn(`node ${node["@id"]} has an empty description`);
        }
      }
      if (ledger.present) {
        for (const row of ledger.rows) {
          for (const ref of parseRelatedIds(row.Related)) {
            if (!resolveRef(ref)) {
              warn(`dependency ${row.ID} references unresolved Related "${ref}"`);
            }
          }
        }
      }
    } catch (error) {
      warn(`cannot check memory quality: ${error.message}`);
    }
  }

  for (const source of config.sources || []) {
    if (source.type === "local") {
      const dir = path.resolve(root, source.path);
      if (!exists(dir)) {
        (source.required ? fail : warn)(`local source "${source.id}": path is missing: ${dir}`);
      }
    } else if (source.type === "git" && options.online) {
      const result = spawnSync("git", ["ls-remote", "--exit-code", source.url, source.ref || "HEAD"], {
        timeout: 10000,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        (source.required ? fail : warn)(
          `git source "${source.id}" is unreachable: ${(result.stderr || "").trim().split("\n")[0] || "git ls-remote failed"}`,
        );
      }
    } else if (source.type === "mcp") {
      if (options.online) {
        warn(`mcp source "${source.id}" was not probed: no MCP adapter in v0.2`);
      }
    }
  }

  if (config.budgets.per_iteration_warn >= config.budgets.per_iteration_stop) {
    fail("budgets.per_iteration_warn must be lower than budgets.per_iteration_stop");
  }
  if (config.execution.isolation === "branch" && config.execution.max_parallel !== 1) {
    fail("execution.isolation=branch requires max_parallel=1");
  }

  if (state && exists(p.manifest)) {
    try {
      const drift = checkProjection(root, config, state);
      if (drift.length) {
        warn(`projection is stale (${drift.join(", ")}); run \`orchid-sdd index\``);
      }
    } catch (error) {
      warn(`cannot verify projection: ${error.message}`);
    }
    const recallFile = path.join(p.index, "recall.json");
    if (!exists(recallFile)) {
      info("recall index is generated; run `orchid-sdd index` or `recall` to rebuild it");
    } else {
      let recallProblem = null;
      try {
        recallProblem = recallIndexProblem(readJson(recallFile), state);
      } catch {
        recallProblem = "unreadable";
      }
      if (recallProblem) {
        info(
          `recall index is ${recallProblem === "unreadable" ? "unreadable" : "stale"}; run \`orchid-sdd index\` or \`recall\` to rebuild it`,
        );
      }
      if (isTracked(root, recallFile)) {
        const rel = path.relative(root, recallFile).split(path.sep).join("/");
        warn(
          `recall index is generated and ignored but still tracked by Git; run \`git rm --cached ${rel}\``,
        );
      }
    }
  }

  if (options.ci) info("doctor --ci: offline checks only");
  if (!options.online) info("network probes skipped (use --online)");
  info(`config hash ${hash}`);
  return finish({ errors, warnings, infos, fixes }, options);
}

function isTracked(root, file) {
  try {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const result = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", rel], {
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function finish(result, options) {
  if (options.strict) {
    result.errors.push(...result.warnings.splice(0));
  }
  if (options.json) {
    process.stdout.write(`${formatJson(result)}\n`);
    return result.errors.length ? 1 : 0;
  }
  process.stdout.write("orchid-sdd doctor\n\n");
  for (const message of result.errors) process.stdout.write(`  [error] ${message}\n`);
  for (const message of result.warnings) process.stdout.write(`  [warn]  ${message}\n`);
  for (const message of result.fixes) process.stdout.write(`  [fix]   ${message}\n`);
  for (const message of result.infos) process.stdout.write(`  [info]  ${message}\n`);
  process.stdout.write(
    `\n${result.errors.length} error(s), ${result.warnings.length} warning(s)\n`,
  );
  return result.errors.length ? 1 : 0;
}
