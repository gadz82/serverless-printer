import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OrchidError, exists, formatJson } from "./util.mjs";

const SKILL_NAME = "orchid-sdd";

const AGENTS = {
  opencode: {
    label: "OpenCode",
    projectSkill: `.opencode/skills/${SKILL_NAME}`,
    projectCommand: `.opencode/commands/${SKILL_NAME}.md`,
    globalSkill: `.config/opencode/skills/${SKILL_NAME}`,
    globalCommand: `.config/opencode/commands/${SKILL_NAME}.md`,
    invocation: "/orchid-sdd <command>",
  },
  "claude-code": {
    label: "Claude Code",
    projectSkill: `.claude/skills/${SKILL_NAME}`,
    globalSkill: `.claude/skills/${SKILL_NAME}`,
    invocation: "/orchid-sdd <command>",
  },
  generic: {
    label: "generic Agent Skills",
    projectSkill: `.agents/skills/${SKILL_NAME}`,
    globalSkill: `.agents/skills/${SKILL_NAME}`,
    invocation: "Load the orchid-sdd skill explicitly",
  },
};

const AGENT_ALIASES = {
  opencode: "opencode",
  "claude-code": "claude-code",
  claude: "claude-code",
  "claude-code-skill": "claude-code",
  generic: "generic",
  agents: "generic",
};

const BUNDLE = [
  "SKILL.md",
  "package.json",
  "LICENSE",
  "bin",
  "cli",
  ".skill",
  "docs/personas",
];

function normalizeAgent(value) {
  const key = String(value || "").trim().toLowerCase();
  const agent = AGENT_ALIASES[key];
  if (!agent) {
    throw new OrchidError(
      `unknown agent "${value}"; use opencode, claude-code, or generic`,
    );
  }
  return agent;
}

function copyEntry(source, target, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function assertWritable(target, force, label) {
  if (exists(target) && !force) {
    throw new OrchidError(
      `${label} already exists: ${target}; use --force to replace it`,
    );
  }
}

export function installSkill(root, skillRoot, args = {}) {
  if (args.action && args.action !== "install") {
    throw new OrchidError(`unknown skill action "${args.action}"; use skill install`);
  }
  if (!args.agent) {
    throw new OrchidError(
      "skill install requires --agent opencode|claude-code|generic",
    );
  }
  if (args.global && args.dest) {
    throw new OrchidError("--global and --dest cannot be used together");
  }

  const agentId = normalizeAgent(args.agent);
  const agent = AGENTS[agentId];
  const global = Boolean(args.global);
  const base = global ? os.homedir() : root;
  const skillRelative = global ? agent.globalSkill : agent.projectSkill;
  const skillTarget = args.dest
    ? path.resolve(root, String(args.dest))
    : path.join(base, skillRelative);
  const commandTarget =
    !args.dest && (global ? agent.globalCommand : agent.projectCommand)
      ? path.join(base, global ? agent.globalCommand : agent.projectCommand)
      : null;

  const resolvedSkill = path.resolve(skillTarget);
  const resolvedSource = path.resolve(skillRoot);
  if (
    resolvedSkill === resolvedSource ||
    resolvedSource.startsWith(`${resolvedSkill}${path.sep}`)
  ) {
    throw new OrchidError(
      "skill destination cannot be the skill package root or one of its ancestors",
    );
  }

  for (const relative of BUNDLE) {
    const source = path.join(skillRoot, relative);
    if (!exists(source)) {
      throw new OrchidError(`skill package is incomplete: missing ${relative}`);
    }
  }

  assertWritable(skillTarget, args.force, "skill destination");
  if (commandTarget) assertWritable(commandTarget, args.force, "command file");

  if (!args.dryRun) {
    if (args.force && exists(skillTarget)) fs.rmSync(skillTarget, { recursive: true, force: true });
    for (const relative of BUNDLE) {
      copyEntry(path.join(skillRoot, relative), path.join(skillTarget, relative), false);
    }
    if (commandTarget) {
      copyEntry(
        path.join(skillRoot, "commands/orchid-sdd.md"),
        commandTarget,
        false,
      );
    }
  }

  const result = {
    agent: agentId,
    label: agent.label,
    scope: global ? "global" : args.dest ? "custom" : "project",
    skill: skillTarget,
    command: commandTarget,
    invocation: agent.invocation,
    dryRun: Boolean(args.dryRun),
  };

  if (args.json) {
    process.stdout.write(`${formatJson(result)}\n`);
    return result;
  }

  process.stdout.write(
    `${args.dryRun ? "Would install" : "Installed"} orchid-sdd skill for ${agent.label} (${result.scope})\n`,
  );
  process.stdout.write(`  skill     ${skillTarget}\n`);
  if (commandTarget) process.stdout.write(`  command   ${commandTarget}\n`);
  process.stdout.write(`  invoke    ${agent.invocation}\n`);
  if (global) {
    process.stdout.write("  note      global skills are available in every project\n");
  }
  return result;
}
