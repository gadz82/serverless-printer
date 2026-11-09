import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectProfile } from "./config.mjs";
import { loadProfile } from "./registry.mjs";
import { OrchidError, exists } from "./util.mjs";
import { parseYaml } from "./yaml.mjs";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".serena",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
  ".knowledge",
  ".orchid",
  ".orchid-migration-bck",
  "data",
  "__pycache__",
]);

function runGit(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 8000,
  });
  return result.status === 0 ? (result.stdout || "").trim() : null;
}

export function gitInfo(repoPath) {
  if (!exists(path.join(repoPath, ".git"))) return { git: false, dirty: 0 };
  const dirty = (runGit(repoPath, ["status", "--porcelain"]) || "").split("\n").filter(Boolean).length;
  const firstLine = (runGit(repoPath, ["log", "--reverse", "--format=%cs"]) || "").split("\n")[0] || null;
  return {
    git: true,
    branch: runGit(repoPath, ["branch", "--show-current"]) || null,
    head: runGit(repoPath, ["rev-parse", "--short", "HEAD"]) || null,
    origin: runGit(repoPath, ["remote", "get-url", "origin"]) || null,
    dirty,
    commits: Number(runGit(repoPath, ["rev-list", "--count", "HEAD"]) || 0),
    firstCommit: firstLine,
    lastCommit: runGit(repoPath, ["log", "-1", "--format=%cs"]) || null,
    tags: (runGit(repoPath, ["tag"]) || "").split("\n").filter(Boolean).length,
  };
}

function uniqueId(base, used) {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

function testsForRepo(repoDir, profile, skillRoot) {
  const has = (name) => exists(path.join(repoDir, name));
  if (has("pyproject.toml") || has("requirements.txt")) {
    const python = has(".venv/bin/python") ? ".venv/bin/python" : "python3";
    return {
      unit: `${python} -m pytest tests/ -x`,
      integration: `${python} -m pytest tests/ -x -m integration`,
      e2e: `${python} -m pytest tests/ -x -m e2e`,
    };
  }
  if (has("package.json")) {
    return {
      unit: "npm test",
      integration: "npm run test:integration",
      e2e: "npm run test:e2e",
    };
  }
  if (has("Makefile")) return { unit: "make test", integration: "make test", e2e: "make test" };
  try {
    return loadProfile(skillRoot, profile).tests || {};
  } catch {
    return {};
  }
}

export function detectWorkspaceRepos(root, skillRoot, { maxDepth = 5 } = {}) {
  const repos = [];
  const used = new Set();
  function scan(dir, depth) {
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (exists(path.join(full, ".git"))) {
        const info = gitInfo(full);
        const base = entry.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        const profile = detectProfile(full);
        const tests = testsForRepo(full, profile, skillRoot);
        repos.push({
          id: uniqueId(base, used),
          path: path.relative(root, full).split(path.sep).join("/"),
          profile,
          enabled: true,
          git: info.git,
          config: "orchid-sdd.yml",
          test_commands: tests,
          personas: [],
          constitution: [],
        });
        continue;
      }
      scan(full, depth + 1);
    }
  }
  scan(root, 0);
  return repos;
}

export function workspaceConfig(repos) {
  return { enabled: repos.length > 0, repos };
}

export function renderRepoFragment(root, repo) {
  const repoDir = path.join(root, repo.path);
  const rootConfig = path.join(root, "orchid-sdd.yml");
  const extendsPath = path.relative(repoDir, rootConfig).split(path.sep).join("/");
  let out = `# orchid-sdd workspace repo override.
# The workspace root owns knowledge, state, manifest, and audit.
extends: ${JSON.stringify(extendsPath)}

project:
  name: ${JSON.stringify(repo.id)}
  profile: ${repo.profile || "custom"}
`;
  const commands = repo.test_commands || {};
  const entries = Object.entries(commands).filter(([, value]) => value);
  if (entries.length) {
    out += "\nexecution:\n  test_commands:\n";
    for (const [key, value] of entries) out += `    ${key}: ${JSON.stringify(value)}\n`;
  }
  if (repo.personas && repo.personas.length) {
    out += `\npersonas:\n  enabled: [${repo.personas.join(", ")}]\n`;
  }
  return out;
}

export function writeRepoFragments(root, repos, { force = false, dryRun = false } = {}) {
  const written = [];
  for (const repo of repos) {
    if (repo.enabled === false) continue;
    const file = path.join(root, repo.path, repo.config || "orchid-sdd.yml");
    if (exists(file) && !force) continue;
    written.push({ repo: repo.id, file, content: renderRepoFragment(root, repo) });
    if (!dryRun) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderRepoFragment(root, repo), "utf8");
    }
  }
  return written;
}

export function loadRepoFragment(repoPath, file) {
  if (!exists(file)) return null;
  let data;
  try {
    data = parseYaml(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new OrchidError(`invalid ${file}: ${error.message}`);
  }
  if (!data || typeof data !== "object") throw new OrchidError(`${file} must be a mapping`);
  const allowed = new Set(["extends", "project", "execution", "personas", "constitution", "sources"]);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) throw new OrchidError(`${file}: "${key}" is not allowed in a repo override`);
  }
  if (!data.extends) throw new OrchidError(`${file}: "extends" is required`);
  return data;
}

export function validateWorkspace(root, config, personas) {
  const errors = [];
  const warnings = [];
  const repos = [];
  if (!config.workspace || !config.workspace.enabled) {
    return { errors, warnings, repos };
  }
  const rootConfig = path.join(root, "orchid-sdd.yml");
  for (const repo of config.workspace.repos || []) {
    if (repo.enabled === false) continue;
    const repoDir = path.join(root, repo.path);
    if (!exists(repoDir)) {
      errors.push(`workspace repo "${repo.id}": path is missing: ${repo.path}`);
      continue;
    }
    const info = gitInfo(repoDir);
    if (repo.git !== false && !info.git) {
      errors.push(`workspace repo "${repo.id}": not a git repository: ${repo.path}`);
    }
    if (repo.config && (path.isAbsolute(repo.config) || repo.config.split("/").includes(".."))) {
      errors.push(`workspace repo "${repo.id}": config path must be relative: ${repo.config}`);
    }
    for (const relative of repo.constitution || []) {
      if (!exists(path.join(repoDir, relative))) {
        errors.push(`workspace repo "${repo.id}": constitution file is missing: ${relative}`);
      }
    }
    for (const id of repo.personas || []) {
      if (personas && !personas.has(id)) {
        errors.push(`workspace repo "${repo.id}": unknown persona "${id}"`);
      }
    }
    const localConfig = path.join(repoDir, repo.config || "orchid-sdd.yml");
    if (exists(localConfig)) {
      try {
        const fragment = loadRepoFragment(repoDir, localConfig);
        const target = path.resolve(repoDir, String(fragment.extends));
        if (target !== path.resolve(rootConfig)) {
          errors.push(`workspace repo "${repo.id}": extends must resolve to the workspace root config`);
        }
        for (const id of (fragment.personas && fragment.personas.enabled) || []) {
          if (personas && !personas.has(id)) {
            errors.push(`workspace repo "${repo.id}": unknown persona "${id}"`);
          }
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    const commands = repo.test_commands || {};
    if (!Object.values(commands).some(Boolean)) {
      warnings.push(`workspace repo "${repo.id}": no test commands configured`);
    }
    if (info.dirty) {
      warnings.push(`workspace repo "${repo.id}": working tree has ${info.dirty} change(s)`);
    }
    repos.push({ ...repo, git: info });
  }
  return { errors, warnings, repos };
}

export function workspaceStatus(root, config) {
  if (!config.workspace || !config.workspace.enabled) return [];
  return (config.workspace.repos || [])
    .filter((repo) => repo.enabled !== false)
    .map((repo) => {
      const repoDir = path.join(root, repo.path);
      const info = exists(repoDir) ? gitInfo(repoDir) : { git: false, dirty: 0 };
      return { ...repo, git: info };
    });
}

export function assertClean(root, config, { allowDirty = false } = {}) {
  if (!config.execution.require_clean_tree || allowDirty) return;
  const dirty = [];
  const rootInfo = gitInfo(root);
  if (rootInfo.git && rootInfo.dirty) dirty.push(`root (${rootInfo.dirty} change(s))`);
  for (const repo of workspaceStatus(root, config)) {
    if (repo.git.git && repo.git.dirty) dirty.push(`${repo.id} (${repo.git.dirty} change(s))`);
  }
  if (dirty.length) {
    throw new OrchidError(
      `clean working tree required; dirty: ${dirty.join(", ")}. Commit/stash or pass --allow-dirty.`,
    );
  }
}

export function findWorkspaceRoot(start) {
  let current = path.resolve(start);
  for (;;) {
    const configFile = path.join(current, "orchid-sdd.yml");
    if (exists(configFile)) {
      try {
        const data = parseYaml(fs.readFileSync(configFile, "utf8"));
        if (data && data.workspace && data.workspace.enabled) return current;
      } catch {
        /* doctor reports malformed config */
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function captureWorkspaceState(root, config) {
  const rootInfo = gitInfo(root);
  const repos = workspaceStatus(root, config).map((repo) => ({
    id: repo.id,
    path: repo.path,
    profile: repo.profile,
    branch: repo.git.branch,
    head: repo.git.head,
    origin: repo.git.origin,
    dirty: repo.git.dirty,
  }));
  return {
    enabled: Boolean(config.workspace && config.workspace.enabled),
    root: {
      branch: rootInfo.branch,
      head: rootInfo.head,
      origin: rootInfo.origin,
      dirty: rootInfo.dirty,
    },
    repos,
  };
}
