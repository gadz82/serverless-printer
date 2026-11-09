import { loadConfig } from "./config.mjs";
import { loadPersonas, resolvePersona } from "./registry.mjs";
import { OrchidError, formatJson } from "./util.mjs";

function effective(root, skillRoot) {
  const { config } = loadConfig(root);
  return { config, personas: loadPersonas(skillRoot, root, config) };
}

export function personaCommand(root, skillRoot, args) {
  const action = args.action || "list";
  const { config, personas } = effective(root, skillRoot);

  if (action === "list") {
    const rows = [...personas.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((persona) => ({
        id: persona.id,
        name: persona.name,
        authority: persona.authority,
        phases: persona.phases,
        source: persona.source,
        enabled: config.personas.enabled.includes(persona.id),
      }));
    if (args.json) {
      process.stdout.write(`${formatJson(rows)}\n`);
      return 0;
    }
    const width = Math.max(4, ...rows.map((row) => row.id.length));
    process.stdout.write(`${"ID".padEnd(width)}  AUTHORITY  ENABLED  SOURCE\n`);
    for (const row of rows) {
      process.stdout.write(
        `${row.id.padEnd(width)}  ${row.authority.padEnd(9)}  ${row.enabled ? "yes" : "no "}      ${row.source}\n`,
      );
    }
    return 0;
  }

  if (action === "show") {
    const raw = args.id;
    if (!raw) throw new OrchidError("persona show requires an ID");
    const id = resolvePersona(raw, personas) || raw;
    const persona = personas.get(id);
    if (!persona) throw new OrchidError(`unknown persona "${raw}"`);
    if (args.json) {
      process.stdout.write(`${formatJson(persona)}\n`);
      return 0;
    }
    process.stdout.write(`${persona.id} — ${persona.name}\n`);
    process.stdout.write(`  authority: ${persona.authority}\n`);
    process.stdout.write(`  phases:    ${persona.phases.join(", ")}\n`);
    process.stdout.write(`  aliases:   ${persona.aliases.join(", ") || "—"}\n`);
    process.stdout.write(`  source:    ${persona.source}\n`);
    process.stdout.write(`  enabled:   ${config.personas.enabled.includes(persona.id) ? "yes" : "no"}\n`);
    if (persona.mission) process.stdout.write(`  mission:   ${persona.mission}\n`);
    if (persona.body) process.stdout.write(`\n${persona.body}\n`);
    return 0;
  }

  throw new OrchidError(`unknown persona action "${action}" (use list or show)`);
}
