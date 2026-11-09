import fs from "node:fs";
import path from "node:path";
import { detectProfile, detectProjectName, loadConfig } from "./config.mjs";
import { runSetup } from "./setup.mjs";
import { detectWorkspaceRepos, gitInfo, workspaceConfig } from "./workspace.mjs";
import { paths, readState, writeProjection, writeState } from "./store.mjs";
import {
  OrchidError,
  ensureDir,
  exists,
  formatJson,
  nowIso,
  readText,
  rel,
  writeJson,
} from "./util.mjs";

export const MIGRATION_DIR = ".orchid/migration";
export const BACKUP_ROOT = ".orchid-migration-bck";

const CODE_EXTS = [
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java",
  ".kt", ".rb", ".php", ".cs", ".swift", ".scala", ".sql", ".sh", ".bash",
];
const LANGUAGE_BY_EXT = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
};
const EXCLUDES = new Set([
  ".git", "node_modules", ".venv", "venv", ".next", ".pytest_cache", ".ruff_cache",
  "dist", "build", "target", "vendor", "coverage", ".knowledge", ".orchid",
  ".orchid-migration-bck", "__pycache__", ".serena",
]);

function walk(dir, onFile) {
  if (!exists(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDES.has(entry.name)) walk(path.join(dir, entry.name), onFile);
    } else if (entry.isFile()) {
      onFile(path.join(dir, entry.name));
    }
  }
}

function knowledgeInventory(dir) {
  if (!exists(dir)) return null;
  const files = [];
  walk(dir, (file) => files.push(file));
  const dirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return {
    path: dir,
    files: files.length,
    dirs,
    sample: files.slice(0, 20).map((file) => rel(path.dirname(dir), file)),
  };
}

function countAnchors(root) {
  let count = 0;
  walk(root, (file) => {
    if (!CODE_EXTS.includes(path.extname(file).toLowerCase())) return;
    try {
      const content = fs.readFileSync(file, "utf8");
      count += (content.match(/ORCHID-MEM:\s*[0-9a-f-]{36}/gi) || []).length;
    } catch {
      /* unreadable files are ignored */
    }
  });
  return count;
}

function languageCounts(root) {
  const counts = {};
  walk(root, (file) => {
    const ext = path.extname(file).toLowerCase();
    if (!ext) return;
    counts[ext] = (counts[ext] || 0) + 1;
  });
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15),
  );
}

function languageSummary(root) {
  const languages = {};
  walk(root, (file) => {
    const ext = path.extname(file).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext];
    if (!language) return;
    if (!languages[language]) languages[language] = { files: 0, extensions: new Set() };
    languages[language].files += 1;
    languages[language].extensions.add(ext);
  });
  return Object.entries(languages)
    .map(([language, value]) => ({
      language,
      files: value.files,
      extensions: [...value.extensions].sort(),
    }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function repoInventory(root, skillRoot) {
  const configured = (() => {
    try {
      const loaded = loadConfig(root, { required: false });
      return loaded && loaded.config.workspace && loaded.config.workspace.enabled
        ? loaded.config.workspace.repos
        : [];
    } catch {
      return [];
    }
  })();
  const detected = detectWorkspaceRepos(root, skillRoot);
  const source = configured.length ? configured : detected;
  return source.map((repo) => {
    const dir = path.join(root, repo.path);
    const localConfig = path.join(dir, repo.config || "orchid-sdd.yml");
    return {
      ...repo,
      git: exists(dir) ? gitInfo(dir) : { git: false, dirty: 0 },
      localConfig: exists(localConfig) ? rel(root, localConfig) : null,
    };
  });
}

export function scanProject(root, skillRoot) {
  let config = null;
  let configError = null;
  try {
    const loaded = loadConfig(root, { required: false });
    config = loaded ? loaded.config : null;
  } catch (error) {
    configError = error.message;
  }
  const repos = repoInventory(root, skillRoot);
  const knowledgeFolder = (config && config.knowledge_folder) || ".knowledge";
  const knowledgeDir = path.join(root, knowledgeFolder);
  const docblocksDir = path.join(
    root,
    (config && config.docblocks_folder) || "docs/knowledge/docblocks",
  );
  const constitutionDir = path.join(
    root,
    (config && config.constitution_folder) || ".orchid/constitution",
  );
  const agentsFile = path.join(root, "AGENTS.md");
  const legacyKnowledge = path.join(root, ".knowledge");

  return {
    root,
    generatedAt: nowIso(),
    projectName: detectProjectName(root),
    profile: detectProfile(root),
    configError,
    config,
    workspace: {
      configured: Boolean(config && config.workspace && config.workspace.enabled),
      detected: repos.length,
      repos,
    },
    knowledge: {
      folder: knowledgeFolder,
      ...(knowledgeInventory(knowledgeDir) || { files: 0, dirs: [], sample: [] }),
      legacy: knowledgeFolder !== ".knowledge" ? knowledgeInventory(legacyKnowledge) : null,
    },
    existing: {
      config: exists(path.join(root, "orchid-sdd.yml")),
      agents: exists(agentsFile),
      agentsLines: exists(agentsFile) ? readText(agentsFile).split("\n").length : 0,
      gitignore: exists(path.join(root, ".gitignore")),
      docblocks: exists(docblocksDir),
      constitution: exists(constitutionDir),
      adr: exists(path.join(knowledgeDir, "adr"))
        ? fs.readdirSync(path.join(knowledgeDir, "adr")).length
        : 0,
      specs: exists(path.join(knowledgeDir, "specs"))
        ? fs.readdirSync(path.join(knowledgeDir, "specs")).length
        : 0,
      plans: exists(path.join(knowledgeDir, "plans"))
        ? knowledgeInventory(path.join(knowledgeDir, "plans"))
        : null,
      prompts: exists(path.join(knowledgeDir, "prompts"))
        ? fs.readdirSync(path.join(knowledgeDir, "prompts")).length
        : 0,
      anchors: countAnchors(root),
    },
    rootGit: gitInfo(root),
    languages: languageCounts(root),
    languagesByName: languageSummary(root),
    suggested: {
      workspace: repos.length > 0,
      profile: repos.length > 0 ? "monorepo" : detectProfile(root),
      knowledgeFolder,
      migrationDir: MIGRATION_DIR,
      backupRoot: BACKUP_ROOT,
    },
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function uniqueDir(parent, base) {
  let dir = path.join(parent, base);
  let suffix = 2;
  while (exists(dir)) dir = path.join(parent, `${base}-${suffix++}`);
  return dir;
}

function backupAssets(root, scan) {
  const assets = [];
  const add = (label, source, group, base = root) => {
    if (exists(source)) {
      assets.push({
        label,
        source,
        group,
        relative: path.relative(base, source).split(path.sep).join("/"),
      });
    }
  };
  add("config", path.join(root, "orchid-sdd.yml"), "root");
  add("state", path.join(root, ".orchid"), "root");
  add("agents", path.join(root, "AGENTS.md"), "root");
  add("gitignore", path.join(root, ".gitignore"), "root");
  add("knowledge", path.join(root, scan.knowledge.folder), "root");
  if (scan.knowledge.folder !== ".knowledge") {
    add("legacy-knowledge", path.join(root, ".knowledge"), "root");
  }
  add("docblocks", path.join(root, (scan.config && scan.config.docblocks_folder) || "docs/knowledge/docblocks"), "root");
  add("constitution", path.join(root, (scan.config && scan.config.constitution_folder) || ".orchid/constitution"), "root");
  add("serena-memories", path.join(root, ".serena", "memories"), "root");
  for (const repo of scan.workspace.repos) {
    const repoDir = path.join(root, repo.path);
    add("agents", path.join(repoDir, "AGENTS.md"), `repos/${repo.id}`, repoDir);
    add("claude", path.join(repoDir, "CLAUDE.md"), `repos/${repo.id}`, repoDir);
    add("config", path.join(repoDir, repo.config || "orchid-sdd.yml"), `repos/${repo.id}`, repoDir);
    add("knowledge", path.join(repoDir, ".knowledge"), `repos/${repo.id}`, repoDir);
  }
  return assets;
}

function copyFilter(source) {
  const name = path.basename(source);
  if ([".git", "node_modules", ".venv", "venv", ".next", "dist", "build", "target", "vendor", "coverage", "__pycache__", ".pytest_cache", ".ruff_cache"].includes(name)) {
    return false;
  }
  if (name.endsWith(".pyc")) return false;
  return true;
}

function walkBackup(dir, onFile) {
  if (!exists(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (![".git", "node_modules", ".venv", "venv", ".next", "dist", "build", "target", "vendor", "coverage", "__pycache__", ".pytest_cache", ".ruff_cache"].includes(entry.name)) {
        walkBackup(path.join(dir, entry.name), onFile);
      }
    } else if (entry.isFile()) {
      onFile(path.join(dir, entry.name));
    }
  }
}

function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  walkBackup(dir, (file) => {
    files += 1;
    try {
      bytes += fs.statSync(file).size;
    } catch {
      /* ignore */
    }
  });
  return { files, bytes };
}

export function backupProject(root, skillRoot, { scan = null, dryRun = false } = {}) {
  const info = scan || scanProject(root, skillRoot);
  const assets = backupAssets(root, info);  const targetRoot = path.join(root, BACKUP_ROOT);
  const target = uniqueDir(targetRoot, timestamp());
  const entries = [];
  for (const asset of assets) {
    const destination = path.join(target, asset.group, asset.relative);
    const stats = fs.statSync(asset.source).isDirectory()
      ? dirStats(asset.source)
      : { files: 1, bytes: fs.statSync(asset.source).size };
    entries.push({
      label: asset.label,
      source: rel(root, asset.source),
      backup: rel(root, destination),
      type: fs.statSync(asset.source).isDirectory() ? "dir" : "file",
      ...stats,
    });
    if (dryRun) continue;
    ensureDir(path.dirname(destination));
    fs.cpSync(asset.source, destination, { recursive: true, filter: copyFilter });
  }
  const manifest = {
    createdAt: nowIso(),
    root,
    backup: target,
    entries,
    restore:
      "Copy the desired folders/files from this backup back to their original paths. Nothing in the source tree was deleted.",
  };
  if (!dryRun) {
    writeJson(path.join(target, "BACKUP.json"), manifest);
    fs.writeFileSync(
      path.join(target, "README.md"),
      `# orchid-sdd migration backup\n\nCreated ${manifest.createdAt}.\n\nThis folder preserves the pre-migration assets. Restore by copying entries from \`BACKUP.json\` back to their original paths.\n\n| Source | Backup | Type | Files |\n|---|---|---|---|\n${entries
        .map((entry) => `| \`${entry.source}\` | \`${entry.backup}\` | ${entry.type} | ${entry.files} |`)
        .join("\n")}\n`,
      "utf8",
    );
  }
  return { target: rel(root, target), manifest, entries, dryRun };
}

const LEGACY_SKIP = new Set([
  "input",
  "run-log",
  "events",
  "index",
  "iterations",
  "manifest.jsonld",
  ".DS_Store",
]);

function moveLegacyToInput(root, scan, backup) {
  if (!backup) {
    throw new OrchidError(
      "refusing to restructure legacy knowledge without a backup; remove --skip-backup",
    );
  }
  const currentKnowledge = path.join(root, ".knowledge");
  const sourceKnowledge = exists(currentKnowledge)
    ? currentKnowledge
    : path.join(root, scan.knowledge.folder);
  if (!exists(sourceKnowledge)) return null;
  const target = path.join(root, scan.knowledge.folder, "input", "legacy");
  const entries = fs
    .readdirSync(sourceKnowledge, { withFileTypes: true })
    .filter((entry) => !LEGACY_SKIP.has(entry.name));
  if (!entries.length) return null;
  ensureDir(target);
  for (const entry of entries) {
    const from = path.join(sourceKnowledge, entry.name);
    const to = path.join(target, entry.name);
    try {
      fs.renameSync(from, to);
    } catch {
      fs.cpSync(from, to, { recursive: true, force: true, filter: copyFilter });
      fs.rmSync(from, { recursive: true, force: true });
    }
  }
  if (sourceKnowledge !== path.join(root, scan.knowledge.folder)) {
    const remaining = fs.readdirSync(sourceKnowledge).filter((name) => name !== ".DS_Store");
    if (!remaining.length) fs.rmSync(sourceKnowledge, { recursive: true, force: true });
  }
  return {
    source: rel(root, sourceKnowledge),
    target: rel(root, target),
    entries: entries.length,
    moved: true,
  };
}

export function renderScan(scan) {
  const repoLines = scan.workspace.repos.length
    ? scan.workspace.repos
        .map(
          (repo) =>
            `| ${repo.id} | \`${repo.path}\` | ${repo.profile} | ${repo.git.branch || "—"} | ${repo.git.head || "—"} | ${repo.git.commits} | ${repo.git.dirty} dirty |`,
        )
        .join("\n")
    : "| — | — | — | — | — | — | — |";
  return `# Migration scan

- Root: \`${scan.root}\`
- Project: ${scan.projectName}
- Detected profile: ${scan.profile}
- Workspace mode: ${scan.workspace.detected ? `yes (${scan.workspace.detected} repo(s))` : "no"}
- Knowledge folder: \`${scan.knowledge.folder}\` (${scan.knowledge.files} files)
- Existing config: ${scan.existing.config ? "yes" : "no"}
- Existing AGENTS.md: ${scan.existing.agents ? `yes (${scan.existing.agentsLines} lines)` : "no"}
- Legacy anchors: ${scan.existing.anchors}
${scan.configError ? `- Config error: ${scan.configError}\n` : ""}
## Repositories

| ID | Path | Profile | Branch | HEAD | Commits | State |
|---|---|---|---|---|---|---|
${repoLines}

## Existing knowledge

- Directories: ${scan.knowledge.dirs.join(", ") || "—"}
- ADRs: ${scan.existing.adr}
- Specs: ${scan.existing.specs}
- Prompts: ${scan.existing.prompts}
- Plans: ${scan.existing.plans ? `${scan.existing.plans.files} files` : "—"}

## Languages

${(scan.languagesByName || [])
  .map(
    (entry) =>
      `- ${entry.language}: ${entry.files} files (${entry.extensions.join(", ")})`,
  )
  .join("\n") || "- —"}

## Suggested migration

- Workspace mode: ${scan.suggested.workspace ? "yes" : "no"}
- Root profile: ${scan.suggested.profile}
- Knowledge folder: \`${scan.suggested.knowledgeFolder}\`
- Backup folder: \`${scan.suggested.backupRoot}\`
`;
}

function planMarkdown(scan, repos, backup) {
  const repoList = repos.length
    ? repos
        .map(
          (repo) =>
            `- \`${repo.id}\` → \`${repo.path}\` (${repo.profile}, ${repo.git.branch || "—"} @ ${repo.git.head || "—"}, ${repo.git.commits} commits)`,
        )
        .join("\n")
    : "- single repository (no nested Git repositories detected)";
  return `# orchid-sdd migration plan

**Status:** scaffolded
**Root:** \`${scan.root}\`
**Backup:** ${backup ? `\`${backup.target}\`` : "**none — backup was skipped**"}
**Knowledge folder:** \`${scan.knowledge.folder}\`
**Profile:** ${scan.suggested.profile}

## Repositories

${repoList}

## What the CLI already did

1. Detected the repository/workspace topology.
2. Backed up the pre-migration assets to \`${backup ? backup.target : BACKUP_ROOT}\`.
3. Moved legacy knowledge into \`${scan.knowledge.folder}/input/legacy/\`.
4. Generated the root \`orchid-sdd.yml\` (workspace-aware).
5. Generated per-repo \`orchid-sdd.yml\` overrides with \`extends\`.
6. Created the root-owned \`.knowledge\` skeleton, state, manifest, and indexes.

The CLI did **not** invent memories. That is the LLM migration work below.

## Non-negotiable rules

- The workspace root owns \`.knowledge\`, state, manifest, indexes, and audit.
- Never edit \`manifest.jsonld\` or \`index/**\` by hand; use \`orchid-sdd record\` and \`orchid-sdd index\`.
- Preserve the backup. Do not delete legacy knowledge until the migration is accepted.
- Reconstruct memories from evidence: existing ADRs/specs/plans/prompts, Git history, file history, code, tests.
- One fact per node, description ≤160 chars, 3–7 topics, provenance via \`--artifact\` and \`--repo\`.
- No fabricated decisions. If evidence is ambiguous, record an \`Assumption\` and a question.

## Stage 1 — Inventory legacy knowledge

Read \`.orchid/migration/scan.json\`, the legacy \`.knowledge/README.md\`, and every
ADR/spec/plan/prompt/progress file. Write \`.orchid/migration/INVENTORY.md\` with:

- decisions (ADR id, title, status, affected repos);
- requirements/specs and their status;
- plans and prompts that are still active;
- progress/retrospective material that explains history;
- gaps and open questions;
- duplicates/conflicts with the current code.

Do not move files yet.

## Stage 2 — Seed the memory graph from existing knowledge

For each ADR, record a \`Decision\` node. For each binding spec, record \`Requirement\`
nodes and \`Scenario\` nodes where Gherkin exists. For active plans, record \`Prompt\`
nodes only if they describe work still to do.

\`\`\`bash
orchid-sdd record --type Decision --alias ADR-021 \\
  --description "Mini-agents are ..." \\
  --topics agents,architecture,decisions \\
  --artifact ${scan.knowledge.folder}/input/legacy/adr/ADR-021-mini-agents.md \\
  --scope project --repo orchid
\`\`\`

Use \`--repo\` only for repo-scoped memories. Keep cross-cutting decisions at root scope.

## Stage 3 — Reconstruct code memory from Git and file history

For each repo:

1. Read \`git log --reverse --format='%h %cs %s'\` and \`git log --follow -- <path>\`.
2. Read tags and release notes to identify stable behaviour.
3. Identify significant code units (public APIs, entry points, contracts, migrations).
4. Add \`ORCHID-MEM: <uuid> — <short behaviour>\` anchors and UUID-named docblocks with a
   \`History\` section.
5. Record \`CodeUnit\` nodes with \`--repo\`, \`--code path#symbol\`, and the docblock artifact.

Do not anchor trivia. Use the anchor policy: public behaviour, entry points, traced
symbols, and any symbol with a docblock.

## Stage 4 — Propose and approve project code-style examples

Analyze the current code in every repository for the languages reported in
\`scan.json.languagesByName\`. Write \`.orchid/migration/CODE-EXAMPLES-PROPOSAL.md\` with one to
three small examples per significant language: a production boundary, an error path, and a
test pattern. Mirror the existing naming, error handling, dependency injection, logging,
formatting, and test seams; do not invent a new style.

Do **not** write the final examples or modify steering yet. Ask the human:

> Approve these code-style examples?

Wait for an explicit answer and record it in the proposal. After approval, write the examples
under \`.orchid/steering/examples/<language>/\` and create a blocking
\`.orchid/steering/code-examples.md\` override that lists them. Run \`orchid-sdd doctor\` and
\`orchid-sdd steering context --phase build\`; every example must resolve and be visible to the
Build phase. If approval is refused, record why and leave the default rule unchanged.

## Stage 5 — Reorganize legacy knowledge safely

The CLI moved reusable legacy material into
\`${scan.knowledge.folder}/input/legacy/\` after creating the backup. Keep the original
taxonomy recognizable (adr/, specs/, plans/, prompts/, progress/). Use those paths when
recording artifacts. The legacy originals no longer remain at the knowledge root; the
backup is the rollback copy.

## Stage 6 — Validate and finalize

\`\`\`bash
orchid-sdd index
orchid-sdd lint
orchid-sdd doctor
orchid-sdd migrate finalize
\`\`\`

\`migrate finalize\` writes \`.orchid/migration/REPORT.md\` and moves the project to
\`phase: ready\`. Then start the first real iteration with \`orchid-sdd start\`.

## Acceptance criteria

- Every ADR/spec with current relevance has a memory node pointing to its artifact.
- Every repo's significant code units have anchors, docblocks, and \`History\` references.
- Project code-style examples were proposed for every significant language; approval or
  refusal is recorded. If approved, the blocking \`code-examples\` override resolves.
- \`index --check\`, \`lint\`, and \`doctor\` are clean (or documented waivers).
- The backup exists and \`BACKUP.json\` lists every pre-migration asset.
- No legacy asset was deleted before the backup was verified.
`;
}

function promptsMarkdown(scan) {
  return {
    "01-inventory.md": `# Migration prompt 01 — Inventory

Read \`.orchid/migration/scan.json\`, \`${scan.knowledge.folder}/input/legacy/README.md\`
(if present), and every ADR/spec/plan/prompt/progress file under
\`${scan.knowledge.folder}/input/legacy/\`. Write \`.orchid/migration/INVENTORY.md\` with
decisions, requirements, active plans, progress, gaps, and conflicts. The CLI already
moved legacy material; do not modify or move it again. Do not record nodes yet.

Acceptance: the inventory names every source file it used and flags ambiguities.`,
    "02-memory.md": `# Migration prompt 02 — Seed memory

Using \`INVENTORY.md\`, record \`Decision\`, \`Requirement\`, and \`Scenario\` nodes with
\`orchid-sdd record --scope project\`. Every node needs a ≤160-char description, 3–7 topics,
an artifact under \`${scan.knowledge.folder}/input/legacy/\`, and (for repo-scoped facts)
\`--repo\`. Use aliases for ADR/R/S ids. Do not guess: if a decision is unclear, record an
\`Assumption\` and a question.

Acceptance: each current ADR/spec has at least one linked node; \`orchid-sdd index\` runs.`,
    "03-code.md": `# Migration prompt 03 — Reconstruct code memory

For each repository, inspect current code plus \`git log\`, \`git log --follow\`, tags, and
release notes. Add \`ORCHID-MEM: <uuid> — <short behaviour>\` anchors and UUID-named docblocks
with a \`History\` section for significant units, then record \`CodeUnit\` nodes with \`--repo\`,
\`--code\`, and the docblock artifact. Keep inline comments why-only; do not copy history into
them. Do not anchor trivia. Run \`orchid-sdd lint\` and fix every error.

Acceptance: anchors resolve, docblock History exists, and code units are traceable.`,
    "04-code-examples.md": `# Migration prompt 04 — Project code-style examples

Analyze the current code for every significant language in
\`.orchid/migration/scan.json\` (\`languagesByName\`). Do not limit the work to the most common
language. Ignore generated, vendored, and fixture code.

For each language, select representative production and test files and propose one to three
examples:

- a production boundary (service, handler, adapter, or domain unit);
- an error or failure path;
- a test that shows the project's test seam and naming.

The examples must mirror the existing style: naming, error handling, dependency injection,
logging, formatting, comments, and tests. Use the project's real names and types. Prefer
complete, compilable snippets; label any sketch explicitly.

Write \`.orchid/migration/CODE-EXAMPLES-PROPOSAL.md\` with the detected languages, source
evidence for each proposal, proposed destination under \`.orchid/steering/examples/<language>/\`,
and the snippet. Do **not** write the final examples or modify steering yet.

Ask the human exactly:

> Approve these code-style examples?

Wait for an explicit answer. Record the approval or refusal, the approver, and the timestamp in
the proposal. If a language has no suitable example, state why and ask for a waiver.

After approval, write the approved examples under \`.orchid/steering/examples/<language>/\` and
create \`.orchid/steering/code-examples.md\` with this shape:

\`\`\`markdown
---
id: code-examples
extends: code-examples
title: Project code-style examples
summary: Generated code follows the project's existing idioms.
kind: example
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [examples, style, project]
examples:
  - path: examples/php/DomainService.php
    title: "PHP service boundary"
    language: php
---
# Rule
Generated code must follow these examples. A deviation requires an ADR.
# Checks
# Evidence
\`\`\`

List every approved example. Run \`orchid-sdd doctor\` and
\`orchid-sdd steering context --phase build\`; every example must resolve and appear in the
Build context.

Acceptance: every significant language has an approved example or a recorded waiver; the
project \`code-examples\` override is blocking and resolves; if the proposal was refused, the
refusal is recorded and no examples or override were created.`,
    "05-finalize.md": `# Migration prompt 05 — Validate and finalize

Verify \`${scan.knowledge.folder}/input/legacy/\` exists and that recorded artifacts point
to it. If it is missing, stop and report; do not delete the originals or the backup.

If code-style examples were approved, verify \`.orchid/steering/code-examples.md\` and every
listed example resolve and appear in \`orchid-sdd steering context --phase build\`. If they were
refused, verify the proposal records the decision.

Run \`orchid-sdd index\`, \`orchid-sdd lint\`, \`orchid-sdd doctor\`, then
\`orchid-sdd migrate finalize\`. Review \`.orchid/migration/REPORT.md\`. Fix findings
before finalizing. Do not delete the backup.

Acceptance: phase is \`ready\`, the report is written, and the next \`orchid-sdd start\`
can begin.`,
  };
}

function migrationReadme(scan, backup, repos, status = "scaffolded") {
  if (status === "complete") {
    return `# orchid-sdd migration

**Status:** complete
**Root:** \`${scan.root}\`
**Backup:** ${backup ? `\`${backup.target}\`` : "none (backup was skipped)"}
**Knowledge:** \`${scan.knowledge.folder}\`
**Legacy material:** \`${scan.knowledge.folder}/input/legacy/\`
**Repositories:** ${repos.length ? repos.map((repo) => `\`${repo.id}\``).join(", ") : "single repository"}

The migration is complete. See \`.orchid/migration/REPORT.md\` for counts and the backup
location. The pre-migration assets remain in the backup.

Next: \`orchid-sdd start "<title>"\`.
`;
  }
  return `# orchid-sdd migration

**Status:** ${status}
**Root:** \`${scan.root}\`
**Backup:** ${backup ? `\`${backup.target}\`` : "none (backup was skipped)"}
**Knowledge:** \`${scan.knowledge.folder}\`
**Legacy material:** \`${scan.knowledge.folder}/input/legacy/\`
**Repositories:** ${repos.length ? repos.map((repo) => `\`${repo.id}\``).join(", ") : "single repository"}

The CLI has scaffolded the root config, workspace overrides, knowledge skeleton, legacy
move, and migration plan. The semantic reconstruction is **LLM agent work**:

1. Read \`.orchid/migration/PLAN.md\` and \`.orchid/migration/scan.json\`.
2. Execute the prompts in \`.orchid/migration/prompts/\` in order.
3. Record memories with \`orchid-sdd record\` (never edit the manifest).
4. Run \`orchid-sdd index\`, \`orchid-sdd lint\`, \`orchid-sdd doctor\`.
5. Run \`orchid-sdd migrate finalize\` when the acceptance criteria are met.

The pre-migration assets are preserved in the backup. Do not delete them until the
migration is accepted.
`;
}

function writeScaffold(root, scan, backup, repos, legacy = null) {
  const dir = path.join(root, MIGRATION_DIR);
  ensureDir(path.join(dir, "prompts"));
  writeJson(path.join(dir, "scan.json"), scan);
  if (backup) writeJson(path.join(dir, "BACKUP.json"), backup.manifest);
  fs.writeFileSync(path.join(dir, "PLAN.md"), planMarkdown(scan, repos, backup), "utf8");
  for (const [name, content] of Object.entries(promptsMarkdown(scan))) {
    fs.writeFileSync(path.join(dir, "prompts", name), `${content}\n`, "utf8");
  }
  const status = {
    stage: "scaffolded",
    createdAt: nowIso(),
    backup: backup ? backup.target : null,
    repos: repos.map((repo) => repo.id),
    scan: `${MIGRATION_DIR}/scan.json`,
    legacy,
  };
  writeJson(path.join(dir, "STATUS.json"), status);
  fs.writeFileSync(path.join(root, "MIGRATION.md"), migrationReadme(scan, backup, repos), "utf8");
  return { dir, status };
}

export function migrateInit(root, skillRoot, options = {}) {
  const scan = scanProject(root, skillRoot);
  const repos = options.single ? [] : scan.workspace.repos;
  const stateFile = path.join(root, ".orchid", "state.json");
  if (exists(stateFile)) {
    const state = readState(root);
    if (state.activeIteration) {
      throw new OrchidError(
        `iteration "${state.activeIteration}" is active; close or abandon it before migrating`,
      );
    }
  }
  if (scan.existing.config && !options.force) {
    throw new OrchidError(
      "orchid-sdd.yml already exists; inspect `orchid-sdd migrate scan`, or use --force to migrate",
    );
  }

  if (options.dryRun) {
    const preview = backupProject(root, skillRoot, { scan, dryRun: true });
    process.stdout.write(`Migration dry run for ${root}\n`);
    process.stdout.write(`  workspace: ${repos.length ? repos.map((repo) => repo.id).join(", ") : "single repo"}\n`);
    process.stdout.write(`  backup: ${preview.target}\n`);
    for (const entry of preview.entries) process.stdout.write(`    ${entry.source} → ${entry.backup}\n`);
    process.stdout.write(`  config: orchid-sdd.yml\n`);
    for (const repo of repos) {
      process.stdout.write(`  repo config: ${path.join(repo.path, repo.config || "orchid-sdd.yml")}\n`);
    }
    process.stdout.write(`  plan: ${MIGRATION_DIR}/PLAN.md\n`);
    process.stdout.write(`  prompts: ${MIGRATION_DIR}/prompts/\n`);
    process.stdout.write(`  legacy: ${scan.knowledge.folder}/input/legacy/\n`);
    return 0;
  }

  const backup = options.skipBackup
    ? null
    : backupProject(root, skillRoot, { scan });
  if (!backup) {
    process.stdout.write("  [warn] backup skipped by request\n");
  }
  const legacy = moveLegacyToInput(root, scan, backup);

  runSetup(root, skillRoot, {
    profile: options.profile || scan.suggested.profile,
    project: options.project || scan.projectName,
    workspace: repos.length ? true : false,
    workspaceRepos: repos,
    knowledgeFolder: options.knowledgeFolder || scan.knowledge.folder,
    docblocksFolder: options.docblocksFolder,
    constitutionFolder: options.constitutionFolder,
    customizationsFolder: options.customizationsFolder,
    force: true,
    yes: true,
  });

  const scaffold = writeScaffold(root, scan, backup, repos, legacy);
  const state = readState(root);
  state.phase = "migration";
  state.migration = {
    stage: "scaffolded",
    backup: backup ? backup.target : null,
    startedAt: nowIso(),
    repos: repos.map((repo) => repo.id),
    legacy,
  };
  state.gates.G0 = "passed";
  writeState(root, state);
  writeProjection(root, loadConfig(root).config, state);

  process.stdout.write(`Migration scaffolded for ${scan.projectName}\n`);
  process.stdout.write(`  backup     ${backup ? backup.target : "none"}\n`);
  process.stdout.write(`  config     orchid-sdd.yml\n`);
  process.stdout.write(`  workspace  ${repos.length ? `${repos.length} repo(s)` : "single repo"}\n`);
  if (legacy) {
    process.stdout.write(
      `  legacy     ${legacy.entries} entr${legacy.entries === 1 ? "y" : "ies"} moved → ${legacy.target}\n`,
    );
  }
  process.stdout.write(`  plan       ${MIGRATION_DIR}/PLAN.md\n`);
  process.stdout.write(`  prompts    ${MIGRATION_DIR}/prompts/\n`);
  process.stdout.write(`Next: execute the migration prompts, validate, then \`orchid-sdd migrate finalize\`\n`);
  return 0;
}

export function migrateStatus(root, args = {}) {
  const file = path.join(root, MIGRATION_DIR, "STATUS.json");
  if (!exists(file)) {
    if (args.json) process.stdout.write(`${formatJson({ status: "none" })}\n`);
    else process.stdout.write("No migration in progress.\n");
    return 0;
  }  const status = JSON.parse(readText(file));
  if (args.json) {
    process.stdout.write(`${formatJson(status)}\n`);
    return 0;
  }
  process.stdout.write(`Migration stage: ${status.stage}\n`);
  if (status.backup) process.stdout.write(`  backup: ${status.backup}\n`);
  if (status.repos && status.repos.length) process.stdout.write(`  repos:  ${status.repos.join(", ")}\n`);
  process.stdout.write(`  since:  ${status.createdAt}\n`);
  return 0;
}

export function migrateFinalize(root, skillRoot, options = {}) {
  const loaded = loadConfig(root);
  const state = readState(root);
  if (!state.migration && !options.force) {
    throw new OrchidError("no migration in progress; run `orchid-sdd migrate init` first");
  }
  if (state.migration?.legacy) {
    const legacyPath = path.join(root, loaded.config.knowledge_folder, "input", "legacy");
    if (!exists(legacyPath)) {
      throw new OrchidError(
        `legacy material is missing from ${loaded.config.knowledge_folder}/input/legacy; rerun migrate init or pass --force`,
      );
    }
  }
  const { manifest } = writeProjection(root, loaded.config, state);
  if (!manifest.nodes.length && !options.force) {
    throw new OrchidError(
      "migration has no memory nodes; reconstruct at least one node or pass --force",
    );
  }
  const statusFile = path.join(root, MIGRATION_DIR, "STATUS.json");
  const status = exists(statusFile) ? JSON.parse(readText(statusFile)) : {};
  const report = `# Migration report

- Finished: ${nowIso()}
- Backup: ${status.backup || "none"}
- Repositories: ${(status.repos || []).join(", ") || "single repository"}
- Nodes: ${manifest.nodes.length}
- History pointers: ${manifest.history.length}
- Knowledge: \`${loaded.config.knowledge_folder}\`
- Legacy material: \`${loaded.config.knowledge_folder}/input/legacy\`
- Workspace: ${loaded.config.workspace && loaded.config.workspace.enabled ? `${loaded.config.workspace.repos.length} repo(s)` : "disabled"}

## Next

\`\`\`bash
orchid-sdd start "<title>"
\`\`\`
`;
  ensureDir(path.join(root, MIGRATION_DIR));
  fs.writeFileSync(path.join(root, MIGRATION_DIR, "REPORT.md"), report, "utf8");
  const nextStatus = { ...status, stage: "complete", finishedAt: nowIso(), nodes: manifest.nodes.length };
  writeJson(statusFile, nextStatus);
  fs.writeFileSync(
    path.join(root, "MIGRATION.md"),
    migrationReadme(
      { root, knowledge: { folder: loaded.config.knowledge_folder } },
      status.backup ? { target: status.backup } : null,
      (status.repos || []).map((id) => ({ id })),
      "complete",
    ),
    "utf8",
  );
  state.phase = "ready";
  state.migration = { ...(state.migration || {}), stage: "complete", finishedAt: nowIso() };
  state.gates.G0 = "passed";
  writeState(root, state);
  writeProjection(root, loaded.config, state);
  process.stdout.write(`Migration complete: ${manifest.nodes.length} node(s)\n`);
  process.stdout.write(`  report ${MIGRATION_DIR}/REPORT.md\n`);
  process.stdout.write(`Next: orchid-sdd start "<title>"\n`);
  return 0;
}

export function migrateCommand(root, skillRoot, args = {}) {
  const action = String(args.action || "status").toLowerCase();
  if (action === "scan") {
    const scan = scanProject(root, skillRoot);
    const output = args.output
      ? path.resolve(root, args.output)
      : null;
    if (output) {
      ensureDir(path.dirname(output));
      fs.writeFileSync(
        output,
        output.endsWith(".json") ? `${formatJson(scan)}\n` : `${renderScan(scan)}\n`,
        "utf8",
      );
    }
    if (args.json) process.stdout.write(`${formatJson(scan)}\n`);
    else if (!output) process.stdout.write(renderScan(scan));
    else process.stdout.write(`Wrote ${rel(root, output)}\n`);
    return 0;
  }
  if (action === "backup") {
    const result = backupProject(root, skillRoot, { dryRun: Boolean(args.dryRun) });
    if (args.json) {
      process.stdout.write(`${formatJson({ backup: result.target, entries: result.entries })}\n`);
      return 0;
    }
    process.stdout.write(`${result.dryRun ? "Would back up" : "Backed up"} ${result.entries.length} asset(s) to ${result.target}\n`);
    for (const entry of result.entries) {
      process.stdout.write(`  ${entry.source} → ${entry.backup} (${entry.files} files)\n`);
    }
    return 0;
  }
  if (action === "init") return migrateInit(root, skillRoot, args);
  if (action === "status") return migrateStatus(root, args);
  if (action === "finalize") return migrateFinalize(root, skillRoot, args);
  throw new OrchidError(`unknown migrate action "${action}" (use scan, backup, init, status, finalize)`);
}
