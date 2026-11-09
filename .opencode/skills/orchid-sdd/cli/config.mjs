import fs from "node:fs";
import path from "node:path";
import { canonicalHash, deepMerge, OrchidError } from "./util.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

const S = {
  str: { kind: "string" },
  int: { kind: "integer" },
  bool: { kind: "boolean" },
  any: { kind: "any" },
  enum: (...values) => ({ kind: "enum", values }),
  list: (of = { kind: "string" }) => ({ kind: "array", of }),
  map: (keys = {}, extra = false) => ({ kind: "object", keys, extra }),
  mapOf: (value) => ({ kind: "objectOf", value }),
};

export const PHASE_NAMES = [
  "intent",
  "discovery",
  "assessment",
  "planning",
  "build",
  "code_review",
  "logic_review",
];

export const STEERING_KINDS = [
  "architecture",
  "code_style",
  "example",
  "repository",
  "process",
  "custom",
];

export const EFFORTS = ["low", "medium", "high", "extra-high", "ultra"];

export const DEFAULT_CONFIG = {
  version: 1,
  project: { name: "project", profile: "custom", default_branch: "main" },
  workspace: { enabled: false, repos: [] },
  knowledge_folder: ".knowledge",
  docblocks_folder: "docs/knowledge/docblocks",
  constitution_folder: ".orchid/constitution",
  customizations_folder: ".orchid/custom",
  knowledge: {
    manifest: "manifest.jsonld",
    iteration_naming: "{date}-{slug}",
    indexing: ["topics", "questions", "code_anchors", "requirements", "dependencies", "timeline", "repos"],
    bus_expiry_days: 7,
    commit: true,
  },
  docblocks: {
    enabled: true,
    layout: "uuid",
    granularity: "symbol",
    max_behavior_comment_chars: 500,
    anchor_prefix: "ORCHID-MEM",
    require_docblock_for_anchor: true,
  },
  personas: {
    enabled: ["PM", "DEV", "QE"],
    search_paths: [".orchid/personas", "domains/*/personas"],
    overrides: {},
  },
  constitution: {
    layers: ["skill:default", "profile", "project"],
    require_adr_for_deviation: true,
    lock: true,
  },
  steering: {
    enabled: [
      "architecture-boundaries",
      "solid-principles",
      "dependency-inversion-container",
      "code-style",
      "code-examples",
      "repository-flow",
      "saga-pattern",
      "discovery-steering",
      "logic-review-steering",
    ],
    search_paths: [".orchid/steering", "domains/*/steering"],
    overrides: {},
    phases: {
      discovery: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-style",
        "code-examples",
        "repository-flow",
        "saga-pattern",
        "discovery-steering",
      ],
      assessment: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-style",
        "code-examples",
        "repository-flow",
        "saga-pattern",
      ],
      planning: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-examples",
        "repository-flow",
        "saga-pattern",
      ],
      build: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-style",
        "code-examples",
        "repository-flow",
        "saga-pattern",
      ],
      code_review: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-style",
        "code-examples",
        "repository-flow",
        "saga-pattern",
      ],
      logic_review: [
        "architecture-boundaries",
        "solid-principles",
        "dependency-inversion-container",
        "code-style",
        "code-examples",
        "repository-flow",
        "saga-pattern",
        "logic-review-steering",
      ],
    },
  },
  models: {
    default_effort: "medium",
    mismatch: "warn",
    efforts: {},
    phases: {
      intent: "medium",
      discovery: "medium",
      assessment: "high",
      planning: "high",
      build: "high",
      code_review: "high",
      logic_review: "extra-high",
    },
    prompts: {},
  },
  sources: [],
  phases: {
    discovery: { personas: ["PM"] },
    assessment: { personas: ["TECH_LEAD", "DEV", "QE"] },
    logic_review: { personas: ["PM"] },
  },
  execution: {
    max_parallel: 4,
    isolation: "worktree",
    require_clean_tree: true,
    integration_branch: "orchid/{iteration}/integration",
    release_strategy: "squash",
    merge: "orchestrator",
    max_fix_loops: 3,
    test_commands: {
      unit: "npm test",
      integration: "npm run test:integration",
      e2e: "npm run test:e2e",
    },
  },
  reviews: {
    adversarial: {
      enabled: true,
      independent_context: true,
      mode: "auto",
      min_reviewers: 1,
      by_rigor: { S: 1, M: 1, L: 2 },
      block_on: ["critical", "high"],
      routing: {},
    },
    logic: { against: ["prd", "trd", "gherkin"], max_loops: 2 },
  },
  budgets: {
    unit: "tokens",
    per_iteration_warn: 250000,
    per_iteration_stop: 600000,
    per_prompt_warn: 40000,
  },
  governance: {
    approvals: ["intent", "assessment", "plan", "logic_review", "closure", "handover"],
    questionnaires: "md",
    max_questions_per_round: 7,
    adr_required_for: ["breaking_change", "new_dependency", "constitution_deviation", "data_deletion"],
    title_max_chars: 500,
    rigor: "auto",
  },
  telemetry: { run_log: ".knowledge/run-log/", redact: ["secrets", "tokens", "pii"] },
};

export const CONFIG_SCHEMA = S.map({
  version: S.int,
  project: S.map({
    name: S.str,
    profile: S.enum("backend", "frontend", "infra", "monorepo", "custom"),
    default_branch: S.str,
  }),
  workspace: S.map({
    enabled: S.bool,
    repos: S.list(
      S.map({
        id: S.str,
        path: S.str,
        profile: S.enum("backend", "frontend", "infra", "monorepo", "custom"),
        enabled: S.bool,
        git: S.bool,
        config: S.str,
        test_commands: S.mapOf(S.str),
        personas: S.list(S.str),
        constitution: S.list(S.str),
        sources: S.list(S.any),
      }),
    ),
  }),
  knowledge_folder: S.str,
  docblocks_folder: S.str,
  constitution_folder: S.str,
  customizations_folder: S.str,
  knowledge: S.map({
    manifest: S.str,
    iteration_naming: S.str,
    indexing: S.list(S.str),
    bus_expiry_days: S.int,
    commit: S.bool,
  }),
  docblocks: S.map({
    enabled: S.bool,
    layout: S.enum("uuid"),
    granularity: S.enum("symbol", "file"),
    max_behavior_comment_chars: S.int,
    anchor_prefix: S.str,
    require_docblock_for_anchor: S.bool,
  }),
  personas: S.map({
    enabled: S.list(S.str),
    search_paths: S.list(S.str),
    overrides: S.mapOf(
      S.map({ authority: S.enum("advisory", "blocking"), file: S.str, phases: S.list(S.str) }),
    ),
  }),
  constitution: S.map({
    layers: S.list(S.str),
    require_adr_for_deviation: S.bool,
    lock: S.bool,
  }),
  steering: S.map({
    enabled: S.list(S.str),
    search_paths: S.list(S.str),
    overrides: S.mapOf(
      S.map({
        authority: S.enum("advisory", "blocking"),
        file: S.str,
        phases: S.list(S.str),
      }),
    ),
    phases: S.mapOf(S.list(S.str)),
  }),
  models: S.map({
    default_effort: S.enum(...EFFORTS),
    mismatch: S.enum("warn", "block"),
    efforts: S.map(
      Object.fromEntries(
        EFFORTS.map((effort) => [effort, S.map({ agent: S.any, model: S.any })]),
      ),
    ),
    phases: S.mapOf(S.enum(...EFFORTS)),
    prompts: S.mapOf(S.any),
  }),
  sources: S.list(S.any),
  phases: S.mapOf(S.map({ personas: S.list(S.str) })),
  execution: S.map({
    max_parallel: S.int,
    isolation: S.enum("worktree", "clone", "branch"),
    require_clean_tree: S.bool,
    integration_branch: S.str,
    release_strategy: S.enum("squash", "pr", "none"),
    merge: S.str,
    max_fix_loops: S.int,
    test_commands: S.mapOf(S.str),
  }),
  reviews: S.map({
    adversarial: S.map({
      enabled: S.bool,
      independent_context: S.bool,
      mode: S.enum("per_prompt", "batch", "auto"),
      min_reviewers: S.int,
      by_rigor: S.mapOf(S.int),
      block_on: S.list(S.str),
      routing: S.mapOf(S.list(S.str)),
    }),
    logic: S.map({ against: S.list(S.str), max_loops: S.int }),
  }),
  budgets: S.map({
    unit: S.str,
    per_iteration_warn: S.int,
    per_iteration_stop: S.int,
    per_prompt_warn: S.int,
  }),
  governance: S.map({
    approvals: S.list(S.str),
    questionnaires: S.str,
    max_questions_per_round: S.int,
    adr_required_for: S.list(S.str),
    title_max_chars: S.int,
    rigor: S.enum("auto", "light", "standard", "full"),
  }),
  telemetry: S.map({ run_log: S.str, redact: S.list(S.str) }),
});

function validate(value, spec, at, errors) {
  const where = at || "config";
  switch (spec.kind) {
    case "any":
      return;
    case "string":
      if (typeof value !== "string") errors.push(`${where} must be a string`);
      return;
    case "integer":
      if (!Number.isInteger(value)) errors.push(`${where} must be an integer`);
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${where} must be a boolean`);
      return;
    case "enum":
      if (!spec.values.includes(value)) {
        errors.push(`${where} must be one of: ${spec.values.join(", ")}`);
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${where} must be a list`);
        return;
      }
      value.forEach((item, i) => validate(item, spec.of, `${where}[${i}]`, errors));
      return;
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${where} must be a mapping`);
        return;
      }
      for (const [key, inner] of Object.entries(value)) {
        if (Object.prototype.hasOwnProperty.call(spec.keys, key)) {
          validate(inner, spec.keys[key], at ? `${at}.${key}` : key, errors);
        } else if (!spec.extra) {
          errors.push(`${at ? `${at}.` : ""}${key} is not a recognized key`);
        }
      }
      return;
    }
    case "objectOf": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${where} must be a mapping`);
        return;
      }
      for (const [key, inner] of Object.entries(value)) {
        validate(inner, spec.value, at ? `${at}.${key}` : key, errors);
      }
      return;
    }
    default:
      errors.push(`${where} has an unknown schema type`);
  }
}

const SOURCE_SCHEMA = S.map({
  id: S.str,
  type: S.enum("mcp", "git", "local"),
  required: S.bool,
  trust: S.str,
  snapshot: S.bool,
  server: S.str,
  tools: S.list(S.str),
  url: S.str,
  ref: S.str,
  path: S.str,
});

function validateSources(value, errors, prefix = "sources") {
  if (!Array.isArray(value)) return;
  value.forEach((source, i) => {
    const at = `${prefix}[${i}]`;
    validate(source, SOURCE_SCHEMA, at, errors);
    if (!source || typeof source !== "object") return;
    if (!source.id) errors.push(`${at}.id is required`);
    if (source.type === "mcp" && !source.server) {
      errors.push(`${at}.server is required for type mcp`);
    }
    if (source.type === "git" && !source.url) {
      errors.push(`${at}.url is required for type git`);
    }
    if (source.type === "local" && !source.path) {
      errors.push(`${at}.path is required for type local`);
    }
  });
}

export function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return ["config root must be a mapping"];
  }
  validate(raw, CONFIG_SCHEMA, "", errors);
  validatePaths(raw, errors);
  validateSources(raw.sources, errors);
  validateWorkspace(raw.workspace, errors);
  validateSteering(raw.steering, errors);
  validateModels(raw.models, errors);
  return errors;
}

function validateModels(models, errors) {
  if (!models || typeof models !== "object" || Array.isArray(models)) return;
  for (const effort of EFFORTS) {
    const mapping = (models.efforts && models.efforts[effort]) || {};
    for (const field of ["agent", "model"]) {
      const value = mapping[field];
      if (value !== null && value !== undefined && typeof value !== "string") {
        errors.push(`models.efforts.${effort}.${field} must be a string or null`);
      }
    }
  }
  for (const phase of Object.keys(models.phases || {})) {
    if (!PHASE_NAMES.includes(phase)) {
      errors.push(`models.phases.${phase} is not a recognized phase`);
    }
  }
  for (const [id, value] of Object.entries(models.prompts || {})) {
    if (!/^P-[0-9]{3}$/.test(id)) {
      errors.push(`models.prompts.${id} must be a prompt id like P-001`);
      continue;
    }
    if (typeof value === "string") {
      if (!EFFORTS.includes(value)) {
        errors.push(`models.prompts.${id} must be one of: ${EFFORTS.join(", ")}`);
      }
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`models.prompts.${id} must be an effort or a phase-to-effort map`);
      continue;
    }
    for (const [phase, effort] of Object.entries(value)) {
      if (!PHASE_NAMES.includes(phase)) {
        errors.push(`models.prompts.${id}.${phase} is not a recognized phase`);
      }
      if (!EFFORTS.includes(effort)) {
        errors.push(`models.prompts.${id}.${phase} must be one of: ${EFFORTS.join(", ")}`);
      }
    }
  }
}

function validatePaths(raw, errors) {
  for (const key of [
    "knowledge_folder",
    "docblocks_folder",
    "constitution_folder",
    "customizations_folder",
  ]) {
    if (raw[key] === undefined) continue;
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${key} must be a non-empty relative path`);
      continue;
    }
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
      errors.push(`${key} must be a relative path inside the project`);
    }
  }
  const overrides = (raw.personas && raw.personas.overrides) || {};
  for (const [id, override] of Object.entries(overrides)) {
    if (!override || typeof override !== "object" || !override.file) continue;
    const value = override.file;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      path.isAbsolute(value) ||
      value.split(/[\\/]/).includes("..")
    ) {
      errors.push(`personas.overrides.${id}.file must be a relative path inside the project`);
    }
  }
}

function validateWorkspace(workspace, errors) {
  if (!workspace || typeof workspace !== "object") return;
  const repos = Array.isArray(workspace.repos) ? workspace.repos : [];
  if (workspace.enabled && !repos.length) {
    errors.push("workspace.enabled is true but workspace.repos is empty");
  }
  const ids = new Set();
  const paths = new Set();
  repos.forEach((repo, index) => {
    const at = `workspace.repos[${index}]`;
    if (!repo || typeof repo !== "object") return;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(repo.id || ""))) {
      errors.push(`${at}.id must be lowercase letters, digits, dot, dash, or underscore`);
    }
    if (ids.has(repo.id)) errors.push(`${at}.id is duplicated: ${repo.id}`);
    ids.add(repo.id);
    const repoPath = String(repo.path || "");
    if (!repoPath || path.isAbsolute(repoPath) || repoPath.split("/").includes("..")) {
      errors.push(`${at}.path must be a relative path inside the workspace`);
    }
    if (paths.has(repoPath)) errors.push(`${at}.path is duplicated: ${repoPath}`);
    paths.add(repoPath);
    if (repo.enabled === false) return;
    if (repo.sources) validateSources(repo.sources, errors, `${at}.sources`);
  });
}

function validateSteering(steering, errors) {
  if (!steering || typeof steering !== "object" || Array.isArray(steering)) return;
  const enabled = Array.isArray(steering.enabled) ? steering.enabled : [];
  const seen = new Set();
  for (const id of enabled) {
    if (seen.has(id)) errors.push(`steering.enabled has a duplicate rule: ${id}`);
    seen.add(id);
  }
  for (const value of steering.search_paths || []) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      path.isAbsolute(value) ||
      value.split(/[\\/]/).includes("..")
    ) {
      errors.push(`steering.search_paths must contain relative paths inside the project`);
    }
  }
  for (const [phase, ids] of Object.entries(steering.phases || {})) {
    if (!PHASE_NAMES.includes(phase)) {
      errors.push(`steering.phases.${phase} is not a recognized phase`);
    }
    if (!Array.isArray(ids)) continue;
    const phaseSeen = new Set();
    for (const id of ids) {
      if (phaseSeen.has(id)) {
        errors.push(`steering.phases.${phase} has a duplicate rule: ${id}`);
      }
      phaseSeen.add(id);
    }
  }
  for (const [id, override] of Object.entries(steering.overrides || {})) {
    if (!override || typeof override !== "object" || !override.file) continue;
    if (
      typeof override.file !== "string" ||
      !override.file.trim() ||
      path.isAbsolute(override.file) ||
      override.file.split(/[\\/]/).includes("..")
    ) {
      errors.push(`steering.overrides.${id}.file must be a relative path inside the project`);
    }
  }
}

export function loadConfig(root, { required = true } = {}) {
  const file = path.join(root, "orchid-sdd.yml");
  if (!fs.existsSync(file)) {
    if (!required) return null;
    throw new OrchidError(`no orchid-sdd.yml in ${root}; run \`orchid-sdd setup\` first`);
  }
  let raw;
  try {
    raw = parseYaml(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new OrchidError(`invalid orchid-sdd.yml: ${error.message}`);
  }
  if (raw && typeof raw === "object" && raw.extends) {
    throw new OrchidError(
      "this is a workspace repo override; run orchid-sdd from the workspace root",
    );
  }
  const errors = validateConfig(raw);
  if (errors.length) {
    throw new OrchidError(`invalid orchid-sdd.yml:\n - ${errors.join("\n - ")}`);
  }
  const config = deepMerge(DEFAULT_CONFIG, raw);
  return { config, raw, hash: canonicalHash(config), path: file };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function renderModelsBlock(models = DEFAULT_CONFIG.models) {
  let out = "models:\n";
  out += `  default_effort: ${models.default_effort}\n`;
  out += `  mismatch: ${models.mismatch}\n`;
  const efforts = Object.entries(models.efforts || {});
  if (!efforts.length) {
    out += "  efforts: {}\n";
  } else {
    out += "  efforts:\n";
    for (const [effort, mapping] of efforts) {
      out += `    ${effort}:\n`;
      out += `      agent: ${mapping.agent === null || mapping.agent === undefined ? "null" : yamlString(mapping.agent)}\n`;
      out += `      model: ${mapping.model === null || mapping.model === undefined ? "null" : yamlString(mapping.model)}\n`;
    }
  }
  out += "  phases:\n";
  for (const phase of PHASE_NAMES) {
    out += `    ${phase}: ${models.phases[phase] || models.default_effort}\n`;
  }
  out += "  prompts: {}\n";
  return out;
}

function renderSteeringBlock(steering = DEFAULT_CONFIG.steering) {
  let out = "steering:\n";
  out += `  enabled: [${steering.enabled.join(", ")}]\n`;
  out += "  search_paths:\n";
  for (const value of steering.search_paths) out += `    - ${yamlString(value)}\n`;
  out += "  overrides: {}\n";
  out += "  phases:\n";
  for (const [phase, ids] of Object.entries(steering.phases)) {
    out += `    ${phase}: [${ids.join(", ")}]\n`;
  }
  return out;
}

function renderWorkspaceBlock(workspace) {
  if (!workspace || !workspace.enabled) {
    return "workspace:\n  enabled: false\n  repos: []\n";
  }
  let out = "workspace:\n  enabled: true\n  repos:\n";
  for (const repo of workspace.repos || []) {
    out += `    - id: ${yamlString(repo.id)}\n`;
    out += `      path: ${yamlString(repo.path)}\n`;
    out += `      profile: ${repo.profile || "custom"}\n`;
    out += `      enabled: ${repo.enabled === false ? "false" : "true"}\n`;
    out += `      git: ${repo.git === false ? "false" : "true"}\n`;
    out += `      config: ${yamlString(repo.config || "orchid-sdd.yml")}\n`;
    const commands = repo.test_commands || {};
    if (Object.keys(commands).length) {
      out += "      test_commands:\n";
      for (const [key, value] of Object.entries(commands)) {
        if (value) out += `        ${key}: ${yamlString(value)}\n`;
      }
    }
    if (repo.personas && repo.personas.length) {
      out += `      personas: [${repo.personas.join(", ")}]\n`;
    }
    if (repo.constitution && repo.constitution.length) {
      out += `      constitution: [${repo.constitution.map(yamlString).join(", ")}]\n`;
    }
  }
  return out;
}

export function renderConfig({
  projectName,
  profileId,
  personas,
  routing,
  tests,
  paths = {},
  workspace = null,
  steering = DEFAULT_CONFIG.steering,
  models = DEFAULT_CONFIG.models,
}) {
  const knowledgeFolder = paths.knowledgeFolder || ".knowledge";
  const docblocksFolder = paths.docblocksFolder || "docs/knowledge/docblocks";
  const constitutionFolder = paths.constitutionFolder || ".orchid/constitution";
  const customizationsFolder = paths.customizationsFolder || ".orchid/custom";
  const workspaceBlock = renderWorkspaceBlock(workspace);
  const assessment = ["TECH_LEAD", "DEV", "QE"].filter((p) => personas.includes(p));
  if (personas.includes("DBA")) assessment.push("DBA");
  const assessmentLine = (assessment.length ? assessment : ["DEV", "QE"]).join(", ");
  const keys = Object.keys(routing || {});
  let routingBlock = "    routing: {}\n";
  if (keys.length) {
    routingBlock = "    routing:\n";
    for (const key of keys) {
      routingBlock += `      ${JSON.stringify(key)}: [${routing[key].join(", ")}]\n`;
    }
  }
  return `version: 1

project:
  name: ${yamlString(projectName)}
  profile: ${profileId}
  default_branch: main

${workspaceBlock}
knowledge_folder: ${yamlString(knowledgeFolder)}
docblocks_folder: ${yamlString(docblocksFolder)}
constitution_folder: ${yamlString(constitutionFolder)}
customizations_folder: ${yamlString(customizationsFolder)}

knowledge:
  manifest: manifest.jsonld
  iteration_naming: "{date}-{slug}"
  indexing: [topics, questions, code_anchors, requirements, dependencies, timeline, repos]
  bus_expiry_days: 7
  commit: true

docblocks:
  enabled: true
  layout: uuid
  granularity: symbol
  max_behavior_comment_chars: 500
  anchor_prefix: ORCHID-MEM
  require_docblock_for_anchor: true

personas:
  enabled: [${personas.join(", ")}]
  search_paths:
    - .orchid/personas
    - domains/*/personas
  overrides: {}

constitution:
  layers: [skill:default, profile, project]
  require_adr_for_deviation: true
  lock: true

${renderSteeringBlock(steering)}
${renderModelsBlock(models)}
sources: []

phases:
  discovery:
    personas: [PM]
  assessment:
    personas: [${assessmentLine}]
  logic_review:
    personas: [PM]

execution:
  max_parallel: 4
  isolation: worktree
  require_clean_tree: true
  integration_branch: "orchid/{iteration}/integration"
  release_strategy: squash
  merge: orchestrator
  max_fix_loops: 3
  test_commands:
    unit: ${yamlString(tests.unit)}
    integration: ${yamlString(tests.integration)}
    e2e: ${yamlString(tests.e2e)}

reviews:
  adversarial:
    enabled: true
    independent_context: true
    mode: auto
    min_reviewers: 1
    by_rigor: { S: 1, M: 1, L: 2 }
    block_on: [critical, high]
${routingBlock}  logic:
    against: [prd, trd, gherkin]
    max_loops: 2

budgets:
  unit: tokens
  per_iteration_warn: 250000
  per_iteration_stop: 600000
  per_prompt_warn: 40000

governance:
  approvals: [intent, assessment, plan, logic_review, closure, handover]
  questionnaires: md
  max_questions_per_round: 7
  adr_required_for: [breaking_change, new_dependency, constitution_deviation, data_deletion]
  title_max_chars: 500
  rigor: auto

telemetry:
  run_log: ${yamlString(`${knowledgeFolder}/run-log/`)}
  redact: [secrets, tokens, pii]
`;
}

export function detectProjectName(root) {
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (data.name) return String(data.name).replace(/^@[^/]+\//, "");
    } catch {
      /* ignore malformed package.json */
    }
  }
  return path.basename(root) || "project";
}

export function detectProfile(root) {
  const has = (name) => fs.existsSync(path.join(root, name));
  if (has("pnpm-workspace.yaml") || has("lerna.json") || has("nx.json") || has("turbo.json")) {
    return "monorepo";
  }
  const pkgPath = path.join(root, "package.json");
  let deps = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.workspaces) return "monorepo";
      deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {
      /* ignore malformed package.json */
    }
  }
  if (["react", "vue", "svelte", "next", "nuxt", "@angular/core", "vite", "astro"].some((d) => deps[d])) {
    return "frontend";
  }
  if (
    has("pyproject.toml") || has("go.mod") || has("Cargo.toml") ||
    has("pom.xml") || has("build.gradle") || fs.existsSync(pkgPath)
  ) {
    return "backend";
  }
  if (has("Dockerfile") || has("docker-compose.yml") || has("terraform") || has("helm") || has("k8s") || has("ansible")) {
    return "infra";
  }
  return "custom";
}
