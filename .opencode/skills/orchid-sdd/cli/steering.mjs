import fs from "node:fs";
import path from "node:path";
import { PHASE_NAMES, STEERING_KINDS, loadConfig } from "./config.mjs";
import { expandDirs } from "./registry.mjs";
import { readState } from "./store.mjs";
import { OrchidError, exists, formatJson, readText } from "./util.mjs";
import { parseFrontMatter } from "./yaml.mjs";

const ID_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const KINDS = new Set(STEERING_KINDS);
const AUTHORITIES = new Set(["advisory", "blocking"]);

function listMarkdown(dir, { recursive = false, seen = new Set() } = {}) {
  const out = [];
  if (!exists(dir) || seen.has(dir)) return out;
  seen.add(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === "examples" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...listMarkdown(full, { recursive, seen }));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(full);
    }
  }
  return out;
}

function normalizeExamples(value, file) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OrchidError(`${file}: examples must be a list`);
  const baseDir = path.dirname(file);
  return value.map((item, index) => {
    if (typeof item === "string") {
      return {
        path: item,
        title: item,
        language: null,
        file: path.resolve(baseDir, item),
      };
    }
    if (!item || typeof item !== "object" || Array.isArray(item) || !item.path) {
      throw new OrchidError(`${file}: examples[${index}] must be a path or a mapping with path`);
    }
    return {
      path: String(item.path),
      title: item.title ? String(item.title) : String(item.path),
      language: item.language ? String(item.language) : null,
      file: path.resolve(baseDir, String(item.path)),
    };
  });
}

function readSteeringFile(file, source) {
  let parsed;
  try {
    parsed = parseFrontMatter(readText(file));
  } catch (error) {
    throw new OrchidError(`invalid steering file ${file}: ${error.message}`);
  }
  const data = parsed.data || {};
  if (!data.id && path.basename(file) === "README.md") return null;
  const id = String(data.id || "");
  if (!ID_RE.test(id)) {
    throw new OrchidError(`steering file ${file} has an invalid id: "${id}"`);
  }
  const kind = data.kind ? String(data.kind) : "custom";
  if (!KINDS.has(kind)) {
    throw new OrchidError(
      `steering "${id}" has an invalid kind "${kind}" (expected ${[...KINDS].join(", ")})`,
    );
  }
  const authority = data.authority ? String(data.authority) : "advisory";
  if (!AUTHORITIES.has(authority)) {
    throw new OrchidError(`steering "${id}" authority must be advisory or blocking`);
  }
  if (data.phases !== undefined && !Array.isArray(data.phases)) {
    throw new OrchidError(`steering "${id}" phases must be a list`);
  }
  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    throw new OrchidError(`steering "${id}" tags must be a list`);
  }
  if (data.references !== undefined && !Array.isArray(data.references)) {
    throw new OrchidError(`steering "${id}" references must be a list`);
  }
  const phases = Array.isArray(data.phases) ? data.phases.map(String) : [];
  for (const phase of phases) {
    if (!PHASE_NAMES.includes(phase)) {
      throw new OrchidError(`steering "${id}" has an unknown phase: "${phase}"`);
    }
  }
  return {
    id,
    title: data.title ? String(data.title) : id,
    summary: data.summary ? String(data.summary) : "",
    kind,
    authority,
    phases,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    references: Array.isArray(data.references) ? data.references.map(String) : [],
    examples: normalizeExamples(data.examples, file),
    extends: data.extends ? String(data.extends) : null,
    body: parsed.body.trim(),
    file,
    baseDir: path.dirname(file),
    source,
  };
}

function mergeSteering(base, override) {
  return {
    ...base,
    ...override,
    id: override.id || base.id,
    title: override.title || base.title,
    summary: override.summary || base.summary,
    kind: override.kind || base.kind,
    authority: override.authority || base.authority,
    phases: override.phases && override.phases.length ? override.phases : base.phases,
    tags: override.tags && override.tags.length ? override.tags : base.tags,
    references:
      override.references && override.references.length ? override.references : base.references,
    examples: override.examples && override.examples.length ? override.examples : base.examples,
    body: override.body || base.body,
    source: "project",
  };
}

export function loadSteering(skillRoot, projectRoot = null, config = null) {
  const skillDir = path.join(skillRoot, ".skill", "steering");
  if (!exists(skillDir)) throw new OrchidError("skill package is missing .skill/steering");
  const steering = new Map();
  for (const file of listMarkdown(skillDir, { recursive: true })) {
    const rule = readSteeringFile(file, "skill");
    if (!rule) continue;
    if (steering.has(rule.id)) {
      throw new OrchidError(`duplicate steering rule "${rule.id}" in the skill package`);
    }
    steering.set(rule.id, rule);
  }
  if (!projectRoot) return steering;

  const searchPaths =
    (config && config.steering && config.steering.search_paths) || [".orchid/steering"];
  const seen = new Set();
  for (const pattern of searchPaths) {
    for (const folder of expandDirs(projectRoot, pattern)) {
      for (const file of listMarkdown(folder)) {
        if (seen.has(file)) continue;
        seen.add(file);
        const rule = readSteeringFile(file, "project");
        if (!rule) continue;
        const extendsId = rule.extends && rule.extends !== "default" ? rule.extends : rule.id;
        const base = steering.get(extendsId) || steering.get(rule.id);
        if (base) {
          steering.set(rule.id || base.id, mergeSteering(base, rule));
        } else {
          steering.set(rule.id, rule);
        }
      }
    }
  }

  const overrides = (config && config.steering && config.steering.overrides) || {};
  for (const [id, override] of Object.entries(overrides)) {
    const base = steering.get(id);
    if (!base) continue;
    let merged = base;
    if (override && override.file && projectRoot) {
      const file = path.resolve(projectRoot, override.file);
      if (!exists(file)) {
        throw new OrchidError(`steering override "${id}": file not found: ${override.file}`);
      }
      const fromFile = readSteeringFile(file, "project");
      if (fromFile) merged = mergeSteering(base, fromFile);
    }
    steering.set(id, {
      ...merged,
      id,
      file: merged.file,
      baseDir: merged.baseDir,
      phases: (override && override.phases) || merged.phases,
      authority: (override && override.authority) || merged.authority,
      source: `${base.source}+config`,
    });
  }
  return steering;
}

export function validateSteeringRefs(config, steering) {
  const errors = [];
  const enabled = new Set();
  const configured = (config && config.steering) || {};
  for (const id of configured.enabled || []) {
    if (!steering.has(id)) errors.push(`steering.enabled: unknown rule "${id}"`);
    else enabled.add(id);
  }
  for (const id of enabled) {
    const rule = steering.get(id);
    for (const example of rule.examples) {
      const file = example.file || path.resolve(rule.baseDir, example.path);
      if (!exists(file)) {
        errors.push(`steering "${rule.id}": example file is missing: ${example.path}`);
      }
    }
  }
  for (const [phase, ids] of Object.entries(configured.phases || {})) {
    if (!PHASE_NAMES.includes(phase)) {
      errors.push(`steering.phases.${phase}: unknown phase`);
      continue;
    }
    for (const id of ids || []) {
      if (!steering.has(id)) errors.push(`steering.phases.${phase}: unknown rule "${id}"`);
      else if (!enabled.has(id)) {
        errors.push(`steering.phases.${phase}: "${id}" is not enabled`);
      }
    }
  }
  for (const id of Object.keys(configured.overrides || {})) {
    if (!steering.has(id)) errors.push(`steering.overrides.${id}: unknown rule`);
  }
  return errors;
}

export function activeSteering(config, steering, phase) {
  if (!PHASE_NAMES.includes(phase)) return [];
  const configured = (config && config.steering && config.steering.phases) || {};
  if (Array.isArray(configured[phase])) {
    return configured[phase].map((id) => steering.get(id)).filter(Boolean);
  }
  const enabled = new Set((config && config.steering && config.steering.enabled) || []);
  return [...steering.values()].filter(
    (rule) => enabled.has(rule.id) && rule.phases.includes(phase),
  );
}

export function steeringArtifact(phase) {
  return {
    discovery: "discovery/steering.md",
    assessment: "assessment/steering.md",
    planning: "plan/steering.md",
    build: "reviews/steering.md",
    code_review: "reviews/steering.md",
    logic_review: "reviews/steering-review.md",
  }[phase] || `${phase}/steering.md`;
}

export function steeringSummary(rule) {
  return {
    id: rule.id,
    title: rule.title,
    summary: rule.summary,
    kind: rule.kind,
    authority: rule.authority,
    phases: rule.phases,
    tags: rule.tags,
    references: rule.references,
    file: rule.file,
    examples: rule.examples.map((example) => ({
      ...example,
      file: example.file || path.resolve(rule.baseDir, example.path),
    })),
    source: rule.source,
  };
}

function validatePhase(phase) {
  if (!PHASE_NAMES.includes(phase)) {
    throw new OrchidError(`phase must be one of: ${PHASE_NAMES.join(", ")}`);
  }
}

function printRule(rule, examples = false) {
  process.stdout.write(`${rule.id} — ${rule.title}\n`);
  process.stdout.write(`  kind:      ${rule.kind}\n`);
  process.stdout.write(`  authority: ${rule.authority}\n`);
  process.stdout.write(`  phases:    ${rule.phases.join(", ")}\n`);
  process.stdout.write(`  source:    ${rule.source}\n`);
  process.stdout.write(`  file:      ${rule.file}\n`);
  if (rule.summary) process.stdout.write(`  summary:   ${rule.summary}\n`);
  for (const example of rule.examples) {
    const exampleFile = example.file || path.resolve(rule.baseDir, example.path);
    process.stdout.write(`  example:   ${exampleFile}\n`);
    if (examples) {
      if (exists(exampleFile)) process.stdout.write(`\n${readText(exampleFile).trimEnd()}\n\n`);
      else process.stdout.write(`  (missing example file)\n`);
    }
  }
  if (rule.body) process.stdout.write(`\n${rule.body}\n`);
}

export function steeringCommand(root, skillRoot, args = {}) {
  const action = args.action || "list";
  const { config } = loadConfig(root);
  const steering = loadSteering(skillRoot, root, config);
  const errors = validateSteeringRefs(config, steering);
  if (errors.length) {
    throw new OrchidError(`invalid steering configuration:\n - ${errors.join("\n - ")}`);
  }

  if (action === "list") {
    let rows = [...steering.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (args.phase) {
      validatePhase(args.phase);
      const active = new Set(activeSteering(config, steering, args.phase).map((rule) => rule.id));
      rows = rows.filter((rule) => active.has(rule.id));
    }
    const enabled = new Set(config.steering.enabled || []);
    const payload = rows.map((rule) => ({
      ...steeringSummary(rule),
      enabled: enabled.has(rule.id),
    }));
    if (args.json) {
      process.stdout.write(`${formatJson(payload)}\n`);
      return 0;
    }
    const width = Math.max(4, ...rows.map((rule) => rule.id.length));
    process.stdout.write(`${"ID".padEnd(width)}  KIND          AUTHORITY  ENABLED  SOURCE\n`);
    for (const rule of rows) {
      process.stdout.write(
        `${rule.id.padEnd(width)}  ${rule.kind.padEnd(12)}  ${rule.authority.padEnd(9)}  ${enabled.has(rule.id) ? "yes" : "no "}      ${rule.source}\n`,
      );
    }
    return 0;
  }

  if (action === "show") {
    const raw = args.id;
    if (!raw) throw new OrchidError("steering show requires an ID");
    const rule = steering.get(String(raw));
    if (!rule) throw new OrchidError(`unknown steering rule "${raw}"`);
    if (args.json) {
      process.stdout.write(`${formatJson({ ...steeringSummary(rule), body: rule.body })}\n`);
      return 0;
    }
    printRule(rule, Boolean(args.examples));
    return 0;
  }

  if (action === "context") {
    let phase = args.phase;
    if (!phase) {
      const state = readState(root);
      phase = state.phase;
    }
    if (!PHASE_NAMES.includes(phase)) {
      throw new OrchidError(
        `steering context requires an active workflow phase (${PHASE_NAMES.join(", ")})`,
      );
    }
    const rules = activeSteering(config, steering, phase);
    const payload = {
      phase,
      artifact: steeringArtifact(phase),
      rules: rules.map(steeringSummary),
    };
    if (args.json) {
      process.stdout.write(`${formatJson(payload)}\n`);
      return 0;
    }
    process.stdout.write(`Steering for ${phase}\n`);
    process.stdout.write(`  artifact: ${payload.artifact}\n`);
    if (!rules.length) {
      process.stdout.write("  no steering rules configured for this phase\n");
      return 0;
    }
    for (const rule of rules) {
      process.stdout.write(
        `  ${rule.id} [${rule.authority}] ${rule.kind} — ${rule.summary || rule.title}\n`,
      );
      process.stdout.write(`    ${rule.file}\n`);
      for (const example of rule.examples) {
        process.stdout.write(
          `    example: ${example.file || path.resolve(rule.baseDir, example.path)}\n`,
        );
      }
    }
    return 0;
  }

  throw new OrchidError(`unknown steering action "${action}" (use list, show, or context)`);
}
