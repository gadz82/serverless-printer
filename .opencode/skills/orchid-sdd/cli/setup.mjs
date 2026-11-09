import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import {
  DEFAULT_CONFIG,
  EFFORTS,
  PHASE_NAMES,
  detectProfile,
  detectProjectName,
  loadConfig,
  renderConfig,
} from "./config.mjs";
import { buildRouting, loadPersonas, loadProfile, resolvePersona, validatePersonaRefs } from "./registry.mjs";
import { loadSteering, validateSteeringRefs } from "./steering.mjs";
import { newState, paths, readState, writeProjection, writeState } from "./store.mjs";
import { OrchidError, ensureDir, exists, formatJson, readText, writeJson } from "./util.mjs";
import { detectWorkspaceRepos, findWorkspaceRoot, workspaceConfig, writeRepoFragments } from "./workspace.mjs";
import { parseFrontMatter } from "./yaml.mjs";

export const AGENTS_BEGIN = "<!-- orchid-sdd:begin -->";
export const AGENTS_END = "<!-- orchid-sdd:end -->";
export const GITIGNORE_BEGIN = "# orchid-sdd:begin";
export const GITIGNORE_END = "# orchid-sdd:end";

export function agentsBlock(knowledgeFolder, constitutionFolder = ".orchid/constitution") {
  return `${AGENTS_BEGIN}
## orchid-sdd memory
- Code may carry \`ORCHID-MEM: <uuid> — <short behaviour>\` anchors. The anchor is the only memory/history reference in code; history lives in the UUID docblock. Resolve it before changing that code's behaviour.
- Inline comments explain why or a non-obvious invariant only; never restate code or copy history.
- Read \`${knowledgeFolder}/manifest.jsonld\` and \`${knowledgeFolder}/index/\` — plain JSON; the JSON-LD context is optional.
- Search by topic or question first: \`orchid-sdd recall <topic|question|uuid|path>\`.
- \`${knowledgeFolder}/index/recall.json\` is generated and Git-ignored; never hand-edit it. When it is missing or stale, run \`orchid-sdd index\` (preferred) or let the first \`recall\` rebuild it. If the CLI is unavailable, warn the user before retrieval: "The recall index cannot be rebuilt without the orchid-sdd CLI. Retrieval is limited to \`manifest.jsonld\` and the versioned core indexes."
- Never edit \`${knowledgeFolder}/**\`, the manifest, or docblocks of code you do not own. Write code; propose knowledge.
- Follow \`${constitutionFolder}/\` for how code is written here.
- Read \`orchid-sdd steering context --phase <phase>\` before Discovery and Logic Review; apply every active rule and cite its ID.
- Before Build, read the Build steering context and follow the project code examples for the language; a deviation requires an ADR.
- Run \`orchid-sdd route --phase <phase>\` before work; if the current model/agent is unknown or mismatched, tell the user. Never switch automatically.
- Track development prompts with \`orchid-sdd prompt start|step|complete\`; save a checkpoint with \`orchid-sdd handoff prepare\` before changing harness.
- Ask before starting whether to create a feature branch and from which base; record the answer in the TRD. If not, stay on the current branch.
- Each prompt gets one disposable worktree and temporary branch; remove both immediately after CR and merge. Never leave an \`orchid/<iteration>/<prompt-id>\` branch behind.
- In workspace mode, record every discovered cross-repo dependency in \`.orchid/cross-repo-dependencies.md\`; cite the \`DEP-###\` row in prompt contracts and CR.
${AGENTS_END}
`;
}

export function gitignoreBlock(knowledgeFolder) {
  return `${GITIGNORE_BEGIN}
${knowledgeFolder}/run-log/
${knowledgeFolder}/index/recall.json
${knowledgeFolder}/iterations/*/execution/runs/
${knowledgeFolder}/iterations/*/plan/prompts/_bus/
.orchid/worktrees/
.orchid-migration-bck/
${GITIGNORE_END}
`;
}

export const CONTEXT = {
  "@context": {
    orchid: "https://orchid.dev/spec/ns#",
    id: "@id",
    type: "@type",
    description: "orchid:description",
    topics: { "@id": "orchid:topic", "@container": "@set" },
    answers: { "@id": "orchid:answers", "@container": "@set" },
    relations: { "@id": "orchid:relations", "@container": "@set" },
    codeAnchor: "orchid:codeAnchor",
    aliases: { "@id": "orchid:alias", "@container": "@set" },
  },
};

export function ciYaml() {
  return `name: orchid-sdd
on:
  push:
  pull_request:
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      # Install the CLI from your registry, or use a linked/local package in CI.
      - run: npm install -g orchid-sdd
      - run: orchid-sdd doctor --ci
      - run: orchid-sdd lint --check
      - run: orchid-sdd index --check
`;
}

export function constitutionTemplate(profileId, files = []) {
  const includes = files.map((file) => `@include _profile/${file}`).join("\n");
  return `# Project constitution

@include skill:constitution.md
${includes ? `\nProfile includes:\n${includes}\n` : ""}
Profile pack: \`.orchid/constitution/_profile/\` (generated for \`${profileId}\`).

Add only project-specific rules below. Same-named files override the skill default;
use \`@include\` to compose instead of replacing.
`;
}

export function profileReadme(profile) {
  return `# Generated profile pack

- Profile: \`${profile.id}\`
- Generated by \`orchid-sdd setup\`.
- Do not edit this folder by hand; use \`.orchid/constitution/\` for project overrides.
${profile.constitution && profile.constitution.length ? `\nProfile additions: ${profile.constitution.join(", ")}\n` : ""}`;
}

export function personasReadme() {
  return `# Project personas

Place project-specific persona overrides here as Markdown files with front matter:

\`\`\`md
---
id: DBA
extends: default
authority: blocking
---
# Operating instructions
...
\`\`\`

The skill defaults live in \`.skill/personas/\`. Project files override by ID
(\`extends\` is optional). See \`docs/orchid-sdd-design.md\` §8 for the contract.\nThe skill package also ships detailed role dossiers under \`docs/personas/\`.
`;
}

export function orchidReadme(config) {
  return `# orchid-sdd

- Project: ${config.project.name}
- Profile: ${config.project.profile}
- Knowledge: \`${config.knowledge_folder}\`
- Docblocks: \`${config.docblocks_folder}\`
- Constitution: \`${config.constitution_folder}\`
- Steering: \`${config.steering.search_paths[0]}\`

Next:

\`\`\`bash
orchid-sdd start "<title>"
\`\`\`
`;
}

export function steeringReadme() {
  return `# Project steering rules

Steering rules are project-owned, phase-aware rules for architecture, code style, examples,
and repository flow. They complement the constitution; they do not replace it.

Add a Markdown file with front matter:

\`\`\`md
---
id: my-project-rule
title: My project rule
summary: One sentence a reviewer can cite.
kind: architecture # architecture | code_style | example | repository | process | custom
authority: blocking # advisory | blocking
phases: [discovery, logic_review]
tags: [architecture, project]
examples:
  - path: examples/my-rule.ts
    title: "Approved shape"
    language: typescript # use the project's language
---
# Rule
...
# Checks
...
# Evidence
...
\`\`\`

The example language is illustrative. Shipped examples cover TypeScript, Go, Python, PHP,
Rust, Java, and Ruby.

Enable it in \`orchid-sdd.yml\`:

\`\`\`yaml
steering:
  enabled: [architecture-boundaries, my-project-rule]
  phases:
    discovery: [architecture-boundaries, my-project-rule]
    logic_review: [architecture-boundaries, my-project-rule]
\`\`\`

Run \`orchid-sdd doctor\`, then \`orchid-sdd steering list\` and
\`orchid-sdd steering context --phase discovery\`.
`;
}

export function appendManaged(file, block, begin, end) {
  if (exists(file)) {
    const current = readText(file);
    if (current.includes(begin)) return false;
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    fs.appendFileSync(file, `${separator}${block}`, "utf8");
    return true;
  }
  fs.writeFileSync(file, block, "utf8");
  return true;
}

function normalizePath(label, value, fallback) {
  const raw = String(value || fallback || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) throw new OrchidError(`${label} must not be empty`);
  if (path.isAbsolute(raw) || raw.split("/").includes("..")) {
    throw new OrchidError(`${label} must be a relative path inside the project: ${raw}`);
  }
  return raw;
}

export function applySteeringChoices(catalog, options = {}) {
  const base = options.base || DEFAULT_CONFIG.steering;
  const includeCore = options.includeCore !== false;
  const presets = [...new Set((options.presets || []).map(String).filter(Boolean))];
  const categories = new Map();
  for (const id of presets) {
    if (!catalog.has(id)) {
      throw new OrchidError(`unknown steering preset "${id}"`);
    }
    const category = id.startsWith("architecture-")
      ? "architecture"
      : id.startsWith("repository-")
        ? "repository"
        : null;
    if (category && categories.has(category)) {
      throw new OrchidError(
        `choose at most one ${category} preset: "${categories.get(category)}" and "${id}"`,
      );
    }
    if (category) categories.set(category, id);
  }

  const enabled = includeCore ? [...base.enabled] : [];
  for (const id of presets) {
    if (!enabled.includes(id)) enabled.push(id);
  }

  const phases = {};
  for (const phase of PHASE_NAMES) {
    const current = base.phases && base.phases[phase];
    if (Array.isArray(current)) {
      phases[phase] = current.filter((id) => enabled.includes(id));
    }
  }
  for (const id of presets) {
    const rule = catalog.get(id);
    for (const phase of rule.phases) {
      if (!phases[phase]) phases[phase] = [];
      if (!phases[phase].includes(id)) phases[phase].push(id);
    }
  }

  const phaseFlags = options.phases || {};
  if (phaseFlags.discovery === false) phases.discovery = [];
  if (phaseFlags.logic_review === false) phases.logic_review = [];

  return {
    ...base,
    enabled,
    phases,
  };
}

function personaMarkdown(persona) {
  const tags = (persona.tags || []).map((tag) => JSON.stringify(String(tag))).join(", ");
  const body = String(persona.body || "")
    .trim()
    .replace(/^# Operating instructions\s*/i, "")
    .trim();
  return `---
id: ${persona.id}
name: ${JSON.stringify(persona.name || persona.id)}
mission: ${JSON.stringify(persona.mission || "")}
phases: [${(persona.phases || []).join(", ")}]
authority: ${persona.authority || "advisory"}
tags: [${tags}]
---
# Operating instructions

${body || `- ${persona.mission || "Follow the front matter contract."}`}
`;
}

export function runSetup(root, skillRoot, options = {}) {
  const parentWorkspace = findWorkspaceRoot(path.dirname(root));
  if (parentWorkspace && path.resolve(parentWorkspace) !== path.resolve(root)) {
    throw new OrchidError(
      `this directory is inside workspace "${parentWorkspace}"; run setup from the workspace root`,
    );
  }
  const profileId = options.profile || detectProfile(root);
  const profile = loadProfile(skillRoot, profileId);
  const catalog = loadPersonas(skillRoot);
  const extras = (options.personas || []).map(
    (value) => resolvePersona(String(value), catalog) || String(value),
  );

  const custom = [];
  for (const file of options.personaFiles || []) {
    const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
    if (!exists(absolute)) throw new OrchidError(`persona file not found: ${file}`);
    let parsed;
    try {
      parsed = parseFrontMatter(readText(absolute));
    } catch (error) {
      throw new OrchidError(`invalid persona file ${file}: ${error.message}`);
    }
    const id = parsed.data && parsed.data.id ? String(parsed.data.id) : "";
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(id)) {
      throw new OrchidError(`persona file ${file} has an invalid id: "${id}"`);
    }
    custom.push({ id, content: readText(absolute), label: file });
  }
  for (const persona of options.customPersonas || []) {
    const id = String((persona && persona.id) || "");
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(id)) {
      throw new OrchidError(`custom persona has an invalid id: "${id}"`);
    }
    custom.push({ id, content: personaMarkdown({ ...persona, id }), label: `persona ${id}` });
  }
  const customIds = custom.map((item) => item.id);
  const personas = [...new Set([...profile.personas, ...extras, ...customIds])];
  for (const id of personas) {
    if (!catalog.has(id) && !customIds.includes(id)) {
      throw new OrchidError(`unknown persona "${id}"`);
    }
  }

  const pathConfig = {
    knowledgeFolder: normalizePath("knowledge folder", options.knowledgeFolder, ".knowledge"),
    docblocksFolder: normalizePath("docblocks folder", options.docblocksFolder, "docs/knowledge/docblocks"),
    constitutionFolder: normalizePath("constitution folder", options.constitutionFolder, ".orchid/constitution"),
    customizationsFolder: normalizePath("customizations folder", options.customizationsFolder, ".orchid/custom"),
  };
  const routing = buildRouting(personas);
  const tests = {
    unit: "npm test",
    integration: "npm run test:integration",
    e2e: "npm run test:e2e",
    ...(profile.tests || {}),
  };
  const projectName = options.project || detectProjectName(root);
  const detectedRepos =
    options.workspaceRepos ||
    (options.workspace === false ? [] : detectWorkspaceRepos(root, skillRoot));
  if (options.workspace === true && !detectedRepos.length) {
    throw new OrchidError("workspace mode requested but no nested git repositories were found");
  }
  const workspace =
    options.workspace !== false && detectedRepos.length ? workspaceConfig(detectedRepos) : null;
  if (options.steeringEnabled === false && (options.steeringPresets || []).length) {
    throw new OrchidError("--no-steering cannot be combined with --steering-preset");
  }
  const steeringConfig = applySteeringChoices(loadSteering(skillRoot), {
    includeCore: options.steeringEnabled !== false,
    presets: options.steeringPresets || [],
    phases: {
      discovery: options.steeringDiscovery !== false,
      logic_review: options.steeringLogicReview !== false,
    },
  });
  const configText = renderConfig({
    projectName,
    profileId,
    personas,
    routing,
    tests,
    paths: pathConfig,
    workspace,
    steering: steeringConfig,
    models: options.models || DEFAULT_CONFIG.models,
  });
  const configPath = path.join(root, "orchid-sdd.yml");
  const statePath = path.join(root, ".orchid", "state.json");

  const dirs = [
    ".orchid/personas",
    ".orchid/steering",
    `${pathConfig.constitutionFolder}/_profile`,
    pathConfig.customizationsFolder,
    `${pathConfig.knowledgeFolder}/events`,
    `${pathConfig.knowledgeFolder}/index`,
    `${pathConfig.knowledgeFolder}/context`,
    `${pathConfig.knowledgeFolder}/iterations`,
    `${pathConfig.knowledgeFolder}/input`,
    `${pathConfig.knowledgeFolder}/run-log`,
    pathConfig.docblocksFolder,
  ].map((item) => path.join(root, item));
  const personaTargets = custom.map((item) =>
    path.join(root, ".orchid", "personas", `${item.id}.md`),
  );
  const repoTargets = workspace
    ? workspace.repos.map((repo) => path.join(root, repo.path, repo.config || "orchid-sdd.yml"))
    : [];

  if (options.dryRun) {
    const entries = [configPath, ...dirs, ...personaTargets, ...repoTargets];
    if (options.json) {
      process.stdout.write(`${formatJson({ dryRun: true, paths: entries })}\n`);
    } else {
      process.stdout.write(`Dry run: ${entries.length} paths\n`);
      for (const entry of entries) process.stdout.write(`  ${entry}\n`);
    }
    return { dryRun: true, paths: entries };
  }

  if (exists(configPath) && !options.force) {
    throw new OrchidError(
      "orchid-sdd.yml already exists; run `orchid-sdd doctor` or use --force to overwrite",
    );
  }

  for (const dir of dirs) ensureDir(dir);
  fs.writeFileSync(configPath, configText, "utf8");

  const writeIfAbsent = (file, content) => {
    ensureDir(path.dirname(file));
    if (!exists(file)) fs.writeFileSync(file, content, "utf8");
  };
  for (const item of custom) {
    const target = path.join(root, ".orchid", "personas", `${item.id}.md`);
    if (exists(target)) {
      if (!options.json) process.stdout.write(`  kept existing persona ${item.id}\n`);
    } else {
      writeIfAbsent(target, item.content);
    }
  }
  if (workspace) {
    writeRepoFragments(root, workspace.repos, { force: Boolean(options.force) });
  }
  const { config, hash } = loadConfig(root);
  const personaMap = loadPersonas(skillRoot, root, config);
  const personaErrors = validatePersonaRefs(config, personaMap);
  if (personaErrors.length) {
    throw new OrchidError(`generated config failed persona validation:\n - ${personaErrors.join("\n - ")}`);
  }
  const steeringMap = loadSteering(skillRoot, root, config);
  const steeringErrors = validateSteeringRefs(config, steeringMap);
  if (steeringErrors.length) {
    throw new OrchidError(`generated config failed steering validation:\n - ${steeringErrors.join("\n - ")}`);
  }

  writeIfAbsent(
    path.join(root, pathConfig.constitutionFolder, "constitution.md"),
    constitutionTemplate(profileId, Array.isArray(profile.constitution) ? profile.constitution : []),
  );
  for (const relative of Array.isArray(profile.constitution) ? profile.constitution : []) {
    const source = path.join(skillRoot, ".skill", "constitution", relative);
    if (exists(source)) {
      writeIfAbsent(
        path.join(root, pathConfig.constitutionFolder, "_profile", relative),
        readText(source),
      );
    }
  }
  writeIfAbsent(
    path.join(root, pathConfig.constitutionFolder, "_profile", "README.md"),
    profileReadme(profile),
  );
  writeIfAbsent(path.join(root, ".orchid", "personas", "README.md"), personasReadme());
  writeIfAbsent(path.join(root, ".orchid", "steering", "README.md"), steeringReadme());
  writeIfAbsent(
    path.join(root, pathConfig.knowledgeFolder, "context", "orchid-v1.jsonld"),
    `${JSON.stringify(CONTEXT, null, 2)}\n`,
  );
  writeIfAbsent(
    path.join(root, pathConfig.knowledgeFolder, "input", "README.md"),
    "# Input\n\nDrop source specs here, or declare external sources in `orchid-sdd.yml`.\n",
  );
  for (const file of ["run-log", "index", "events", "iterations"]) {
    writeIfAbsent(path.join(root, pathConfig.knowledgeFolder, file, ".gitkeep"), "");
  }
  writeIfAbsent(path.join(root, pathConfig.docblocksFolder, ".gitkeep"), "");
  writeIfAbsent(path.join(root, "ORCHID-SDD.md"), orchidReadme(config));
  writeIfAbsent(path.join(root, ".github", "workflows", "orchid-sdd.yml"), ciYaml());

  appendManaged(
    path.join(root, "AGENTS.md"),
    agentsBlock(pathConfig.knowledgeFolder, pathConfig.constitutionFolder),
    AGENTS_BEGIN,
    AGENTS_END,
  );
  appendManaged(
    path.join(root, ".gitignore"),
    gitignoreBlock(pathConfig.knowledgeFolder),
    GITIGNORE_BEGIN,
    GITIGNORE_END,
  );

  let state;
  if (exists(statePath) && !options.force) {
    state = readState(root);
    state.configHash = hash;
  } else {
    state = newState(config, hash);
    state.gates.G0 = "passed";
  }
  writeState(root, state);
  writeProjection(root, config, state, { recall: true });

  if (options.json) {
    process.stdout.write(
      `${formatJson({
        project: config.project.name,
        profile: config.project.profile,
        paths: {
          knowledge: config.knowledge_folder,
          docblocks: config.docblocks_folder,
          constitution: config.constitution_folder,
          customizations: config.customizations_folder,
        },
        personas: config.personas.enabled,
        steering: {
          enabled: config.steering.enabled,
          phases: config.steering.phases,
        },
        models: config.models,
        workspace: config.workspace,
        state: { phase: state.phase, gates: state.gates },
        next: 'orchid-sdd start "<title>"',
      })}\n`,
    );
    return { config, state };
  }
  process.stdout.write(`orchid-sdd configured: ${config.project.name} (profile: ${config.project.profile})\n`);
  process.stdout.write(`  knowledge  ${config.knowledge_folder}\n`);
  process.stdout.write(`  docblocks  ${config.docblocks_folder}\n`);
  process.stdout.write(`  constitution ${config.constitution_folder}\n`);
  process.stdout.write(`  personas   [${config.personas.enabled.join(", ")}]\n`);
  process.stdout.write(`  steering   [${config.steering.enabled.join(", ")}]\n`);
  if (config.workspace && config.workspace.enabled) {
    process.stdout.write(`  workspace  ${config.workspace.repos.length} repo(s): ${config.workspace.repos.map((repo) => repo.id).join(", ")}\n`);
  }
  process.stdout.write(`  state      G0 passed\n`);
  process.stdout.write(`Next: orchid-sdd start "<title>"\n`);
  return { config, state };
}

const ALLOWED_PHASES = PHASE_NAMES;

function parsePhases(value, fallback) {
  const list = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!list.length) return fallback;
  const invalid = list.filter((phase) => !ALLOWED_PHASES.includes(phase));
  if (invalid.length) throw new Error(`unknown phase(s): ${invalid.join(", ")}`);
  return list;
}

function parseAuthority(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "a" || raw === "advisory") return "advisory";
  if (raw === "b" || raw === "blocking") return "blocking";
  throw new Error("authority must be advisory or blocking");
}

async function managePersonas(rl, defaults, profileId, skillRoot, extrasIn, customIn) {
  const profile = loadProfile(skillRoot, profileId);
  const extras = [...extrasIn];
  const custom = new Map((customIn || []).map((persona) => [persona.id, persona]));
  for (;;) {
    const enabled = [...new Set([...profile.personas, ...extras, ...custom.keys()])];
    process.stdout.write(`\nRoles enabled: ${enabled.join(", ")}\n`);
    process.stdout.write("  1) Add a specialist role (for example DBA or SECURITY)\n");
    process.stdout.write("  2) Create a new role\n");
    process.stdout.write("  3) Change an existing role\n");
    process.stdout.write("  4) Done\n");
    const choice = (await rl.question("Choice [4]: ")).trim() || "4";
    if (choice === "1") {
      const available = [...defaults.keys()].filter((id) => !enabled.includes(id));
      if (!available.length) {
        process.stdout.write("All specialist roles are already enabled.\n");
        continue;
      }
      process.stdout.write(`Available specialists: ${available.join(", ")}\n`);
      const input = (await rl.question("Role ID (blank to cancel): ")).trim();
      if (!input) continue;
      const id = resolvePersona(input, defaults);
      if (!id) {
        process.stdout.write(`Unknown role "${input}".\n`);
        continue;
      }
      if (!enabled.includes(id)) extras.push(id);
    } else if (choice === "2") {
      const id = (await rl.question("New role ID (UPPER_SNAKE): ")).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(id)) {
        process.stdout.write("Use 2–31 chars: uppercase letters, digits, underscore.\n");
        continue;
      }
      if (defaults.has(id) || extras.includes(id) || custom.has(id)) {
        process.stdout.write(`Role "${id}" already exists; use option 3 to change it.\n`);
        continue;
      }
      const name = (await rl.question(`Name [${id}]: `)).trim() || id;
      const mission =
        (await rl.question("What does this role own? (one line): ")).trim() ||
        `${name} contributes to the iteration.`;
      let phases;
      let authority;
      try {
        phases = parsePhases(
          (await rl.question("Which phases should this role join? (comma separated) [assessment, code_review]: ")).trim(),
          ["assessment", "code_review"],
        );
        authority = parseAuthority(
          (await rl.question("Should this role block gates? (advisory/blocking) [advisory]: ")).trim(),
          "advisory",
        );
      } catch (error) {
        process.stdout.write(`${error.message}\n`);
        continue;
      }
      const tags = (await rl.question("Topics this role covers (comma separated) [custom]: ")).trim();
      const instruction = (await rl.question("Extra operating instruction (blank for none): ")).trim();
      custom.set(id, {
        id,
        name,
        mission,
        phases,
        authority,
        tags: tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : ["custom"],
        body: instruction ? `- ${instruction}` : "",
      });
      extras.push(id);
    } else if (choice === "3") {
      const available = [...new Set([...defaults.keys(), ...custom.keys()])];
      process.stdout.write(`Current roles: ${available.join(", ")}\n`);
      const input = (await rl.question("Role ID to change (blank to cancel): ")).trim();
      if (!input) continue;
      const id = resolvePersona(input, defaults) || (custom.has(input) ? input : null);
      if (!id) {
        process.stdout.write(`Unknown role "${input}".\n`);
        continue;
      }
      const base = custom.get(id) || defaults.get(id);
      let authority;
      let phases;
      try {
        authority = parseAuthority(
          (await rl.question(`Should this role block gates? (advisory/blocking) [${base.authority}]: `)).trim(),
          base.authority,
        );
        phases = parsePhases(
          (await rl.question(`Which phases should this role join? (comma separated) [${base.phases.join(", ")}]: `)).trim(),
          base.phases.length ? base.phases : ["assessment", "code_review"],
        );
      } catch (error) {
        process.stdout.write(`${error.message}\n`);
        continue;
      }
      const extra = (await rl.question("Add one short operating instruction (blank for none): ")).trim();
      custom.set(id, {
        id,
        name: base.name,
        mission: base.mission,
        phases,
        authority,
        tags: base.tags,
        body: [base.body, extra ? `- ${extra}` : ""].filter(Boolean).join("\n"),
      });
      if (!enabled.includes(id)) extras.push(id);
    } else {
      break;
    }
  }
  return { extras: [...new Set(extras)], customPersonas: [...custom.values()] };
}

const WIZARD_STEPS = 8;

function step(number, title, description = "") {
  process.stdout.write(`\nStep ${number}/${WIZARD_STEPS} — ${title}\n`);
  if (description) process.stdout.write(`${description}\n`);
}

async function askYes(rl, question, fallback = true) {
  const answer = (await rl.question(question)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer === "y" || answer === "yes";
}

const STEERING_PRESET_ALIASES = {
  hex: "architecture-hexagonal",
  hexagonal: "architecture-hexagonal",
  onion: "architecture-onion",
  clean: "architecture-clean",
  ddd: "architecture-ddd",
  cqrs: "architecture-cqrs",
  "event-driven": "architecture-event-driven",
  event: "architecture-event-driven",
  ts: "code-style-typescript",
  typescript: "code-style-typescript",
  go: "code-style-go",
  python: "code-style-python",
  php: "code-style-php",
  rust: "code-style-rust",
  java: "code-style-java",
  ruby: "code-style-ruby",
  sonar: "code-style-sonarqube",
  sonarqube: "code-style-sonarqube",
  trunk: "repository-trunk-based",
  "trunk-based": "repository-trunk-based",
  gitflow: "repository-gitflow",
  xp: "repository-xp-mainline",
  "xp-mainline": "repository-xp-mainline",
  mainline: "repository-xp-mainline",
};

async function chooseSteeringPreset(rl, catalog, label, options) {
  const choices = options.map((id) => id.replace(/^(architecture|code-style|repository)-/, "")).join(", ");
  for (;;) {
    const answer = (
      await rl.question(`${label} (none${choices ? `, ${choices}` : ""}): `)
    )
      .trim()
      .toLowerCase();
    if (!answer || answer === "none") return null;
    const id = STEERING_PRESET_ALIASES[answer] || answer;
    if (options.includes(id) && catalog.has(id)) return id;
    process.stdout.write(`Unknown preset "${answer}". Choose one of: none, ${options.join(", ")}.\n`);
  }
}

async function askEffort(rl, label, fallback) {
  for (;;) {
    const answer = (await rl.question(`${label} [${fallback}] (${EFFORTS.join("/")}): `))
      .trim()
      .toLowerCase();
    if (!answer) return fallback;
    if (EFFORTS.includes(answer)) return answer;
    process.stdout.write(`Unknown effort "${answer}". Choose one of: ${EFFORTS.join(", ")}.\n`);
  }
}

async function manageModels(rl) {
  step(
    7,
    "Choose model and effort routing",
    "This optional step records which agent/model should handle each effort level. It does not switch models. Press Enter to skip any mapping.",
  );
  const customize = await askYes(
    rl,
    "Customize effort routing now? [y/N]: ",
    false,
  );
  if (!customize) {
    return { ...DEFAULT_CONFIG.models, efforts: {}, prompts: {} };
  }

  const defaultEffort = await askEffort(
    rl,
    "Default effort",
    DEFAULT_CONFIG.models.default_effort,
  );
  const phases = {};
  for (const phase of PHASE_NAMES) {
    phases[phase] = await askEffort(
      rl,
      `${phase} effort`,
      DEFAULT_CONFIG.models.phases[phase] || defaultEffort,
    );
  }

  const used = [...new Set([defaultEffort, ...Object.values(phases)])];
  const efforts = {};
  for (const effort of used) {
    const normalize = (value) => {
      const text = value.trim();
      return ["none", "null", "-"].includes(text.toLowerCase()) ? "" : text;
    };
    const agent = normalize(await rl.question(`${effort} agent [none]: `));
    const model = normalize(await rl.question(`${effort} model [none]: `));
    if (agent || model) {
      efforts[effort] = {
        agent: agent || null,
        model: model || null,
      };
    }
  }
  return {
    ...DEFAULT_CONFIG.models,
    default_effort: defaultEffort,
    phases,
    efforts,
    prompts: {},
  };
}

async function manageSteering(rl, catalog) {
  step(
    6,
    "Choose steering rules",
    "Steering rules are standing project rules for architecture, code examples, code style, and repository workflow. The agent must check them during Discovery and Logic Review. You can change them later in orchid-sdd.yml.",
  );
  const enabled = await askYes(
    rl,
    "Enable the recommended core steering rules? [Y/n]: ",
    true,
  );
  if (!enabled) {
    process.stdout.write(
      "Steering disabled. You can add rules later in .orchid/steering/ and orchid-sdd.yml.\n",
    );
    return { enabled: false, presets: [], discovery: false, logicReview: false };
  }

  const presets = [];
  const architecture = await chooseSteeringPreset(
    rl,
    catalog,
    "Architecture preset",
    [
      "architecture-hexagonal",
      "architecture-onion",
      "architecture-clean",
      "architecture-ddd",
      "architecture-cqrs",
      "architecture-event-driven",
    ],
  );
  if (architecture) presets.push(architecture);

  const style = await chooseSteeringPreset(
    rl,
    catalog,
    "Code style preset",
    [
      "code-style-typescript",
      "code-style-go",
      "code-style-python",
      "code-style-php",
      "code-style-rust",
      "code-style-java",
      "code-style-ruby",
      "code-style-sonarqube",
    ],
  );
  if (style) presets.push(style);

  const repository = await chooseSteeringPreset(
    rl,
    catalog,
    "Repository workflow preset",
    [
      "repository-trunk-based",
      "repository-gitflow",
      "repository-xp-mainline",
    ],
  );
  if (repository) presets.push(repository);
  if (repository === "repository-xp-mainline") {
    process.stdout.write(
      "XP mainline allows direct integration to the main branch. Update execution/release settings and record an ADR before using it.\n",
    );
  }

  const discovery = await askYes(
    rl,
    "Apply steering during Discovery (requirements)? [Y/n]: ",
    true,
  );
  const logicReview = await askYes(
    rl,
    "Apply steering during Logic Review (final business check)? [Y/n]: ",
    true,
  );
  return { enabled: true, presets, discovery, logicReview };
}

export async function setupWizard(root, skillRoot, providedProfile, providedProject) {
  if (!process.stdin.isTTY) return null;
  const defaults = loadPersonas(skillRoot);
  const steeringCatalog = loadSteering(skillRoot);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let profile = providedProfile || detectProfile(root);
    let project = providedProject || detectProjectName(root);
    let extras = [];
    let customPersonas = [];
    let steeringOptions = { enabled: true, presets: [], discovery: true, logicReview: true };
    let modelsOptions = { ...DEFAULT_CONFIG.models };
    const paths = {
      knowledgeFolder: ".knowledge",
      docblocksFolder: "docs/knowledge/docblocks",
      constitutionFolder: ".orchid/constitution",
      customizationsFolder: ".orchid/custom",
    };

    for (;;) {
      step(
        1,
        "Choose a profile",
        "A profile is a starting preset. It chooses default personas, test commands, and constitution sections. You can change everything later.\n  backend   = API or service\n  frontend  = browser or mobile app\n  infra     = infrastructure repository\n  monorepo  = workspace with several repositories\n  custom    = minimal setup",
      );
      const chosen = (
        await rl.question(`Profile [${profile}] (backend/frontend/infra/monorepo/custom): `)
      ).trim();
      if (chosen) profile = chosen;
      try {
        loadProfile(skillRoot, profile);
      } catch (error) {
        process.stdout.write(`${error.message}\n`);
        continue;
      }

      step(
        2,
        "Name the project",
        "This name appears in orchid-sdd files, status output, and handover notes. Press Enter to use the detected name.",
      );
      const name = (await rl.question(`Project name [${project}]: `)).trim();
      if (name) project = name;

      step(
        3,
        "Choose where orchid-sdd stores its files",
        "Press Enter to keep each default.\n  knowledge      = project memory, events, and iteration history\n  docblocks      = longer notes linked to important code\n  constitution   = how code must be written\n  customizations = optional template overrides",
      );
      let pathsValid = false;
      while (!pathsValid) {
        const input = {
          knowledgeFolder: (await rl.question(`Knowledge folder [${paths.knowledgeFolder}]: `)).trim(),
          docblocksFolder: (await rl.question(`Docblocks folder [${paths.docblocksFolder}]: `)).trim(),
          constitutionFolder: (await rl.question(`Constitution folder [${paths.constitutionFolder}]: `)).trim(),
          customizationsFolder: (await rl.question(`Customizations folder [${paths.customizationsFolder}]: `)).trim(),
        };
        try {
          for (const [key, value] of Object.entries(input)) {
            if (value) paths[key] = normalizePath(key, value, paths[key]);
          }
          normalizePath("knowledge folder", paths.knowledgeFolder, ".knowledge");
          normalizePath("docblocks folder", paths.docblocksFolder, "docs/knowledge/docblocks");
          normalizePath("constitution folder", paths.constitutionFolder, ".orchid/constitution");
          normalizePath("customizations folder", paths.customizationsFolder, ".orchid/custom");
          pathsValid = true;
        } catch (error) {
          process.stdout.write(`${error.message}\nPlease try the file locations again.\n`);
        }
      }

      step(
        4,
        "Choose workspace mode",
        "Workspace mode is for a root folder that contains several Git repositories. The root keeps one shared knowledge base and each repository keeps a small config override.",
      );
      const detected = detectWorkspaceRepos(root, skillRoot);
      let workspace = false;
      if (detected.length) {
        process.stdout.write(
          `Nested repositories found (${detected.length}): ${detected.map((repo) => repo.id).join(", ")}\n`,
        );
        workspace = await askYes(
          rl,
          "Use workspace mode for these repositories? [Y/n]: ",
          true,
        );
      } else {
        process.stdout.write("No nested Git repositories found; single-repository mode will be used.\n");
      }

      step(
        5,
        "Choose who participates",
        "PM owns product meaning, DEV builds the change, and QE checks test evidence. Every profile includes these three roles. Specialists are optional.",
      );
      const manage = await askYes(rl, "Manage persona roles now? [Y/n]: ", true);
      if (manage) {
        const result = await managePersonas(
          rl,
          defaults,
          profile,
          skillRoot,
          extras,
          customPersonas,
        );
        extras = result.extras;
        customPersonas = result.customPersonas;
      }

      steeringOptions = await manageSteering(rl, steeringCatalog);
      modelsOptions = await manageModels(rl);

      step(
        8,
        "Review and create",
        "Check the choices below. Nothing is written until you confirm; answering no starts over at step 1.",
      );
      const profilePersonas = loadProfile(skillRoot, profile).personas;
      const enabledPersonas = [
        ...new Set([...profilePersonas, ...extras, ...customPersonas.map((persona) => persona.id)]),
      ];
      process.stdout.write(`  Profile:    ${profile}\n`);
      process.stdout.write(`  Project:    ${project}\n`);
      process.stdout.write(`  Knowledge:  ${paths.knowledgeFolder}\n`);
      process.stdout.write(`  Docblocks:  ${paths.docblocksFolder}\n`);
      process.stdout.write(`  Constitution: ${paths.constitutionFolder}\n`);
      process.stdout.write(`  Customizations: ${paths.customizationsFolder}\n`);
      process.stdout.write(`  Workspace:  ${workspace ? "yes" : "no"}\n`);
      process.stdout.write(`  Personas:   ${enabledPersonas.join(", ")}\n`);
      process.stdout.write(
        `  Steering:   ${
          steeringOptions.enabled
            ? [
                `${DEFAULT_CONFIG.steering.enabled.length} core rules`,
                ...(steeringOptions.presets.length ? steeringOptions.presets : []),
                steeringOptions.discovery ? "Discovery enabled" : "Discovery disabled",
                steeringOptions.logicReview ? "Logic Review enabled" : "Logic Review disabled",
              ].join(", ")
            : "disabled"
        }\n`,
      );
      process.stdout.write(
        `  Routing:    default=${modelsOptions.default_effort}; phases=${Object.values(modelsOptions.phases).join("/")}; mapped=${Object.keys(modelsOptions.efforts).join(", ") || "none"}\n`,
      );
      const create = await askYes(rl, "Create these files now? [Y/n]: ", true);
      if (create) {
        return {
          profile,
          project,
          extras,
          customPersonas,
          paths,
          workspace,
          steering: steeringOptions,
          models: modelsOptions,
        };
      }
      process.stdout.write("\nNothing was written. Starting over so you can adjust the answers.\n");
    }
  } catch (error) {
    if (/aborted with ctrl\+d|ctrl\+d|ERR_USE_AFTER_CLOSE/i.test(String(error && error.message))) {
      throw new OrchidError("setup aborted; no files were changed");
    }
    throw error;
  } finally {
    rl.close();
  }
}
