#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_VERSION, OrchidError } from "./util.mjs";
import { runSetup, setupWizard } from "./setup.mjs";
import { personaCommand } from "./persona.mjs";
import { runDoctor } from "./doctor.mjs";
import { index, lint, newUuid, recall, record } from "./memory.mjs";
import {
  abandon,
  close,
  diff,
  gate,
  handover,
  phaseCommand,
  resume,
  start,
  status,
} from "./phases.mjs";
import { migrateCommand } from "./migration.mjs";
import { installSkill } from "./skill.mjs";
import { steeringCommand } from "./steering.mjs";
import { routeCommand } from "./models.mjs";
import { promptCommand } from "./prompts.mjs";
import { handoffCommand } from "./handoff.mjs";
import { dependenciesCommand } from "./dependencies.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VALUE_OPTIONS = new Set([
  "root", "profile", "project", "rigor", "type", "description", "topics", "questions",
  "artifact", "code", "status", "actor", "iteration", "evidence", "note", "hops",
  "path", "wave", "prompt", "id", "alias", "relation", "persona",
  "persona-file", "knowledge-folder", "docblocks-folder", "constitution-folder",
  "customizations-folder", "repo", "output", "scope", "agent", "dest", "phase",
  "steering-preset", "current-agent", "current-model", "step", "reason", "handoff",
  "kind", "limit", "history", "iteration", "budget",
]);
const REPEATABLE = new Set([
  "relation",
  "alias",
  "persona",
  "persona-file",
  "steering-preset",
]);

function parseArgv(argv) {
  let root = process.cwd();
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      root = argv[i + 1] || root;
      i += 1;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    } else {
      rest.push(arg);
    }
  }
  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value = true;
    const equals = key.indexOf("=");
    if (equals >= 0) {
      value = key.slice(equals + 1);
      key = key.slice(0, equals);
    } else if (VALUE_OPTIONS.has(key) && i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
      value = rest[i + 1];
      i += 1;
    }
    if (REPEATABLE.has(key)) {
      if (!Array.isArray(args[key])) args[key] = [];
      args[key].push(value);
    } else {
      args[key] = value;
    }
  }
  return { root: path.resolve(root), args };
}

function flag(value) {
  return value === true || value === "true" || value === "1";
}

function help() {
  return `orchid-sdd ${SKILL_VERSION} — portable, memory-backed SDD for coding agents

Usage: orchid-sdd [--root DIR] <command> [options]

Setup and inspection
  setup                       Configure the project (--profile, --persona, --force, --dry-run)
  skill install               Install the agent skill (--agent opencode|claude-code|generic)
  doctor                      Validate config, paths, state, personas, steering (--ci, --online, --fix)
  status                      Show phase, gates, memory, steering, and next action (--json)
  diff                        Show overrides versus skill defaults (--content)
  steering list|show|context  Inspect and apply phase steering rules
  route                       Resolve the expected agent/model for a phase or prompt
  prompt list|show            Inspect prompt execution state
  prompt validate             Validate plan/prompts contracts (--json)
  prompt start|step|complete|fail|waive  Track development-prompt execution
  handoff list|show|prepare|accept  Save or accept a portable execution handoff

Iteration
  start "<title>"             Start an iteration (--technical-only, --rigor S|M|L)
  gate pass|fail G#           Record a gate with --evidence or --note
  discover | assess | plan    Advance to the next phase (gates enforced)
  build | review              Advance build / logic review
  close --approve             Close the active iteration
  handover [--approve]        Review or accept the human handover
  abandon "<reason>"          Abandon the active iteration
  resume                      Rebuild state and accept the latest handoff
  migrate scan|backup|init|status|finalize   Convert an existing project or workspace

Memory
  record --type T ...         Record a memory node (see below)
  index [--check]             Rebuild or verify manifest and indexes
  recall <uuid|topic|question|path>   Read a compact context pack
  lint [--check]              Validate anchors, docblocks, and comment limits
  dependencies list|check     Inspect and validate the cross-repo dependency ledger
  persona list|show <ID>      Inspect effective personas and overrides
  steering list|show <ID>     Inspect effective steering rules and overrides
  steering context            Show rules active for a phase (--phase discovery|logic_review)
  new-uuid                    Print a UUIDv7

setup options
  --profile backend|frontend|infra|monorepo|custom  --project NAME
  --persona ID[,ID]  --persona-file FILE
  --steering-preset ID  --no-steering
  --no-steering-discovery  --no-steering-logic-review
  --knowledge-folder DIR  --docblocks-folder DIR
  --constitution-folder DIR  --customizations-folder DIR
  --workspace | --single  --yes  --force  --dry-run  --json

skill options
  --agent opencode|claude-code|generic  --global  --dest DIR
  --force  --dry-run  --json

steering options
  --phase intent|discovery|assessment|planning|build|code_review|logic_review
  --examples  --json

route options
  --phase intent|discovery|assessment|planning|build|code_review|logic_review
  --prompt P-001  --current-agent NAME  --current-model NAME  --json

prompt options
  prompt list [--json]
  prompt show P-001 [--json]
  prompt validate [--json]
  prompt start P-001 [--step NAME]
  prompt step P-001 --step NAME
  prompt complete|fail|waive P-001 [--note TEXT] [--evidence PATH] [--json]

handoff options
  handoff list [--json]
  handoff show ID [--json]
  handoff prepare [--reason TEXT] [--json]
  handoff accept ID [--current-agent NAME] [--current-model NAME] [--json]

resume options
  --handoff latest|ID  --no-handoff
  --current-agent NAME  --current-model NAME  --json

record options
  --type Requirement|Scenario|Decision|Prompt|CodeUnit|...
  --description "<=160 chars" --topics a,b,c [--questions "q1;q2"]
  [--artifact path] [--code path#symbol] [--alias R-001]
  [--relation predicate:target] [--status accepted] [--iteration ID]
  [--scope project|iteration] [--repo ID]

recall options
  recall <uuid|topic|question|path|DEP-###> [--repo ID] [--hops 1|2] [--limit 1-100]
         [--history recent|all|none] [--iteration ID] [--summary] [--budget BYTES] [--full]
         [--include-superseded] [--json]

dependencies options
  dependencies list [--repo ID] [--status STATUS] [--kind KIND] [--json]
  dependencies check [--json]

Run \`orchid-sdd <command> --help\` for the full contract; the design is in docs/orchid-sdd-design.md.
`;
}

export async function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help());
    return 0;
  }
  if (argv.includes("--version")) {
    process.stdout.write(`${SKILL_VERSION}\n`);
    return 0;
  }
  const { root, args } = parseArgv(argv);
  const command = args._[0];
  const positional = args._.slice(1);
  const json = flag(args.json);

  try {
    switch (command) {
      case "skill":
        installSkill(root, SKILL_ROOT, {
          action: positional[0] || "install",
          agent: args.agent,
          global: flag(args.global),
          dest: args.dest,
          force: flag(args.force),
          dryRun: flag(args["dry-run"]),
          json,
        });
        return 0;
      case "setup": {
        const options = {
          profile: args.profile,
          project: args.project,
          personas: args.persona,
          personaFiles: args["persona-file"],
          steeringPresets: args["steering-preset"],
          steeringEnabled: !flag(args["no-steering"]),
          steeringDiscovery: !flag(args["no-steering-discovery"]),
          steeringLogicReview: !flag(args["no-steering-logic-review"]),
          workspace: flag(args.workspace) ? true : flag(args.single) ? false : undefined,
          knowledgeFolder: args["knowledge-folder"],
          docblocksFolder: args["docblocks-folder"],
          constitutionFolder: args["constitution-folder"],
          customizationsFolder: args["customizations-folder"],
          force: flag(args.force),
          dryRun: flag(args["dry-run"]),
          yes: flag(args.yes),
          json,
        };
        const interactive =
          !flag(args.yes) &&
          !json &&
          !args.profile &&
          !args.project &&
          !args.persona &&
          !args["persona-file"] &&
          !args["steering-preset"] &&
          !flag(args["no-steering"]) &&
          !flag(args["no-steering-discovery"]) &&
          !flag(args["no-steering-logic-review"]) &&
          !args["knowledge-folder"] &&
          !args["docblocks-folder"] &&
          !args["constitution-folder"] &&
          !args["customizations-folder"] &&
          !flag(args.workspace) &&
          !flag(args.single) &&
          !flag(args["dry-run"]);
        if (interactive) {
          const wizard = await setupWizard(root, SKILL_ROOT, args.profile, args.project);
          if (wizard) {
            options.profile = wizard.profile;
            options.project = wizard.project;
            options.personas = wizard.extras;
            options.customPersonas = wizard.customPersonas;
            options.knowledgeFolder = wizard.paths.knowledgeFolder;
            options.docblocksFolder = wizard.paths.docblocksFolder;
            options.constitutionFolder = wizard.paths.constitutionFolder;
            options.customizationsFolder = wizard.paths.customizationsFolder;
            options.workspace = wizard.workspace;
            options.steeringEnabled = wizard.steering.enabled;
            options.steeringPresets = wizard.steering.presets;
            options.steeringDiscovery = wizard.steering.discovery;
            options.steeringLogicReview = wizard.steering.logicReview;
            options.models = wizard.models;
          }
        }
        runSetup(root, SKILL_ROOT, options);
        return 0;
      }
      case "doctor":
        return runDoctor(root, SKILL_ROOT, {
          ci: flag(args.ci),
          online: flag(args.online),
          fix: flag(args.fix),
          strict: flag(args.strict),
          json,
        });
      case "status":
        return status(root, { json, skillRoot: SKILL_ROOT });
      case "index":
        return index(root, { check: flag(args.check), json });
      case "lint":
        return lint(root, { json });
      case "dependencies":
        return dependenciesCommand(root, {
          action: positional[0] || "list",
          repo: args.repo,
          status: args.status,
          kind: args.kind,
          json,
        });
      case "recall":
        return recall(root, {
          query: positional.join(" "),
          hops: args.hops,
          repo: args.repo,
          limit: args.limit,
          json,
          history: args.history,
          iteration: args.iteration,
          includeSuperseded: flag(args["include-superseded"]),
          summary: flag(args.summary),
          full: flag(args.full),
          budget: args.budget,
        });
      case "record":
        return record(root, {
          type: args.type,
          description: args.description,
          topics: args.topics,
          questions: args.questions,
          artifact: args.artifact,
          code: args.code,
          status: args.status,
          actor: args.actor,
          iteration: args.iteration,
          repo: args.repo,
          scope: args.scope,
          id: args.id,
          alias: args.alias,
          relation: args.relation,
          json,
        });
      case "start":
        return start(root, {
          title: positional.join(" "),
          technicalOnly: flag(args["technical-only"]),
          rigor: args.rigor,
          allowDirty: flag(args["allow-dirty"]),
          json,
        });
      case "gate":
        return gate(root, {
          action: positional[0],
          gate: positional[1],
          evidence: args.evidence,
          note: args.note,
          skillRoot: SKILL_ROOT,
        });
      case "discover":
      case "assess":
      case "plan":
      case "build":
      case "review":
        return phaseCommand(
          root,
          {
            force: flag(args.force),
            json,
            all: flag(args.all),
            prompt: args.prompt,
            wave: args.wave,
            skillRoot: SKILL_ROOT,
          },
          command,
        );
      case "close":
        return close(root, { approve: flag(args.approve), force: flag(args.force), json });
      case "handover":
        return handover(root, { approve: flag(args.approve), force: flag(args.force), json });
      case "abandon":
        return abandon(root, { reason: positional.join(" "), json });
      case "resume":
        return resume(root, {
          handoff: args.handoff,
          noHandoff: flag(args["no-handoff"]),
          currentAgent: args["current-agent"],
          currentModel: args["current-model"],
          json,
        });
      case "diff":
        return diff(root, {
          skillRoot: SKILL_ROOT,
          path: args.path,
          content: flag(args.content),
          json,
        });
      case "migrate":
        return migrateCommand(root, SKILL_ROOT, {
          action: positional[0] || "status",
          output: args.output,
          profile: args.profile,
          project: args.project,
          knowledgeFolder: args["knowledge-folder"],
          docblocksFolder: args["docblocks-folder"],
          constitutionFolder: args["constitution-folder"],
          customizationsFolder: args["customizations-folder"],
          single: flag(args.single),
          workspace: flag(args.workspace),
          force: flag(args.force),
          dryRun: flag(args["dry-run"]),
          skipBackup: flag(args["skip-backup"]),
          json,
        });
      case "new-uuid":
        return newUuid();
      case "persona":
        return personaCommand(root, SKILL_ROOT, {
          action: positional[0] || "list",
          id: positional[1],
          json,
        });
      case "steering":
        return steeringCommand(root, SKILL_ROOT, {
          action: positional[0] || "list",
          id: positional[1],
          phase: args.phase,
          examples: flag(args.examples),
          json,
        });
      case "route":
        return routeCommand(root, {
          phase: args.phase,
          prompt: args.prompt,
          currentAgent: args["current-agent"],
          currentModel: args["current-model"],
          json,
        });
      case "prompt":
        return promptCommand(root, {
          action: positional[0] || "list",
          id: positional[1] || args.id,
          step: args.step,
          note: args.note,
          evidence: args.evidence,
          json,
        });
      case "handoff":
        return handoffCommand(root, {
          action: positional[0] || "list",
          id: positional[1] || args.id,
          reason: args.reason,
          currentAgent: args["current-agent"],
          currentModel: args["current-model"],
          json,
        });
      default:
        process.stderr.write(`orchid-sdd: unknown command "${command}"\n\n`);
        process.stderr.write(help());
        return 2;
    }
  } catch (error) {
    if (error instanceof OrchidError) {
      process.stderr.write(`orchid-sdd: ${error.message}\n`);
      return error.exitCode || 1;
    }
    process.stderr.write(`orchid-sdd: ${error.message}\n`);
    if (process.env.ORCHID_DEBUG) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}
