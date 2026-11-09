import fs from "node:fs";
import path from "node:path";
import { parseFrontMatter } from "./yaml.mjs";
import { OrchidError } from "./util.mjs";

function readPersonaFile(file) {
  const { data, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
  if (!data.id) return null;
  const id = String(data.id);
  return {
    id,
    name: data.name ? String(data.name) : id,
    mission: data.mission ? String(data.mission) : "",
    aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : [],
    phases: Array.isArray(data.phases) ? data.phases.map(String) : [],
    authority: data.authority ? String(data.authority) : "advisory",
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    extends: data.extends ? String(data.extends) : null,
    body: body.trim(),
    file,
    source: "skill",
  };
}

export function expandDirs(root, pattern) {
  const parts = String(pattern).split("/").filter(Boolean);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const base of current) {
      if (part === "*") {
        if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
          if (entry.isDirectory()) next.push(path.join(base, entry.name));
        }
      } else if (part === "**") {
        next.push(base);
      } else {
        next.push(path.join(base, part));
      }
    }
    current = next;
  }
  return current.filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

function mergePersona(base, override) {
  return {
    ...base,
    ...override,
    id: override.id || base.id,
    aliases: override.aliases && override.aliases.length ? override.aliases : base.aliases,
    phases: override.phases && override.phases.length ? override.phases : base.phases,
    tags: override.tags && override.tags.length ? override.tags : base.tags,
    authority: override.authority || base.authority,
    body: override.body || base.body,
    source: "project",
  };
}

export function loadPersonas(skillRoot, projectRoot = null, config = null) {
  const dir = path.join(skillRoot, ".skill", "personas");
  if (!fs.existsSync(dir)) {
    throw new OrchidError("skill package is missing .skill/personas");
  }
  const personas = new Map();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const persona = readPersonaFile(path.join(dir, name));
    if (persona) personas.set(persona.id, persona);
  }
  if (!projectRoot) return personas;

  const searchPaths =
    (config && config.personas && config.personas.search_paths) || [
      ".orchid/personas",
      "domains/*/personas",
    ];
  const seen = new Set();
  for (const pattern of searchPaths) {
    for (const folder of expandDirs(projectRoot, pattern)) {
      for (const name of fs.readdirSync(folder).filter((n) => n.endsWith(".md")).sort()) {
        const file = path.join(folder, name);
        if (seen.has(file)) continue;
        seen.add(file);
        const persona = readPersonaFile(file);
        if (!persona) continue;
        const extendsId =
          persona.extends && persona.extends !== "default" ? persona.extends : persona.id;
        const base = personas.get(extendsId) || personas.get(persona.id);
        if (base) {
          personas.set(persona.id || base.id, mergePersona(base, persona));
        } else {
          personas.set(persona.id, { ...persona, source: "project" });
        }
      }
    }
  }

  const overrides = (config && config.personas && config.personas.overrides) || {};
  for (const [id, override] of Object.entries(overrides)) {
    const base = personas.get(id);
    if (!base) continue;
    let merged = base;
    if (override && override.file && projectRoot) {
      const file = path.resolve(projectRoot, override.file);
      if (!fs.existsSync(file)) {
        throw new OrchidError(`persona override "${id}": file not found: ${override.file}`);
      }
      const fromFile = readPersonaFile(file);
      if (fromFile) merged = mergePersona(base, fromFile);
    }
    personas.set(id, {
      ...merged,
      ...override,
      id,
      phases: (override && override.phases) || merged.phases,
      authority: (override && override.authority) || merged.authority,
      source: `${base.source}+config`,
    });
  }
  return personas;
}

export function resolvePersona(input, personas) {
  if (personas.has(input)) return input;
  for (const persona of personas.values()) {
    if (persona.aliases.includes(input)) return persona.id;
  }
  return null;
}

export function validatePersonaRefs(config, personas) {
  const errors = [];
  const enabled = new Set();
  for (const raw of config.personas.enabled || []) {
    const id = resolvePersona(raw, personas);
    if (!id) {
      errors.push(`personas.enabled: unknown persona "${raw}"`);
    } else if (id !== raw) {
      errors.push(`personas.enabled: use canonical id "${id}" instead of alias "${raw}"`);
    } else {
      enabled.add(id);
    }
  }
  for (const [phase, value] of Object.entries(config.phases || {})) {
    for (const raw of (value && value.personas) || []) {
      const id = resolvePersona(raw, personas);
      if (!id) errors.push(`phases.${phase}.personas: unknown persona "${raw}"`);
      else if (!enabled.has(id)) errors.push(`phases.${phase}.personas: "${raw}" is not enabled`);
    }
  }
  const routing = (config.reviews && config.reviews.adversarial && config.reviews.adversarial.routing) || {};
  for (const [glob, ids] of Object.entries(routing)) {
    for (const raw of ids || []) {
      const id = resolvePersona(raw, personas);
      if (!id) errors.push(`routing "${glob}": unknown persona "${raw}"`);
      else if (!enabled.has(id)) errors.push(`routing "${glob}": "${raw}" is not enabled`);
    }
  }
  return errors;
}

export function loadProfile(skillRoot, id) {
  const file = path.join(skillRoot, ".skill", "templates", "profiles", `${id}.json`);
  if (!fs.existsSync(file)) throw new OrchidError(`unknown profile "${id}"`);
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new OrchidError(`cannot read profile "${id}": ${error.message}`);
  }
  profile.id = profile.id || id;
  profile.personas = Array.isArray(profile.personas) ? profile.personas.map(String) : ["PM", "DEV", "QE"];
  profile.tests = profile.tests || {};
  return profile;
}

export function buildRouting(enabled) {
  const pick = (...candidates) => candidates.find((p) => enabled.includes(p)) || "QE";
  const routing = {
    "**/migrations/**": [pick("DBA", "QE")],
    "infra/**": [pick("DEVOPS", "TECH_LEAD", "QE")],
  };
  const api = ["ARCHITECT", "SECURITY"].filter((p) => enabled.includes(p));
  routing["src/api/**"] = api.length ? api : [pick("TECH_LEAD", "QE")];
  return routing;
}
