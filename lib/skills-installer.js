import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SKILL_SOURCE = "mrscraper-com/cli";
export const SKILL_NAME = "mrscraper";

export const HARNESS_DEFINITIONS = Object.freeze([
  { name: "claude-code", label: "Claude Code", detectPath: ".claude" },
  { name: "cursor", label: "Cursor", detectPath: ".cursor" },
  {
    name: "windsurf",
    label: "Windsurf",
    detectPath: ".codeium/windsurf",
  },
  { name: "codex", label: "Codex", detectPath: ".codex" },
  { name: "continue", label: "Continue", detectPath: ".continue" },
  { name: "roo", label: "Roo Code", detectPath: ".roo" },
  { name: "gemini-cli", label: "Gemini CLI", detectPath: ".gemini" },
  {
    name: "github-copilot",
    label: "GitHub Copilot",
    detectPath: ".copilot",
  },
  { name: "droid", label: "Droid", detectPath: ".factory" },
  {
    name: "opencode",
    label: "OpenCode",
    detectPath: ".config/opencode",
  },
  { name: "openclaw", label: "OpenClaw", detectPath: ".openclaw" },
  { name: "openhands", label: "OpenHands", detectPath: ".openhands" },
  {
    name: "hermes-agent",
    label: "Hermes Agent",
    detectPath: ".hermes",
  },
]);

export const SUPPORTED_HARNESSES = Object.freeze(
  HARNESS_DEFINITIONS.map(({ name }) => name),
);

/** @param {string} directory */
function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} [homeDirectory] */
export function detectInstalledHarnesses(homeDirectory = os.homedir()) {
  return HARNESS_DEFINITIONS.filter(({ detectPath }) =>
    isDirectory(path.join(homeDirectory, detectPath)),
  );
}

/**
 * An outer npm/npx process leaves variables that can interfere with a nested
 * npx invocation. This mirrors the cleanup used by Firecrawl's bootstrap.
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function cleanNpmEnvironment(environment = process.env) {
  const cleaned = { ...environment };
  for (const key of Object.keys(cleaned)) {
    const normalized = key.toUpperCase();
    if (
      normalized.startsWith("NPM_") ||
      normalized === "INIT_CWD" ||
      normalized === "PROJECT_CWD"
    ) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

/** @param {NodeJS.Platform} [platform] */
export function npxExecutable(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

/** @param {NodeJS.Platform} [platform] */
export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

/** @param {string | string[]} agents @param {string} [source] */
export function buildSkillsInstallArgs(agents, source = SKILL_SOURCE) {
  const targetAgents = Array.isArray(agents) ? agents : [agents];
  if (targetAgents.length === 0) {
    throw new Error("At least one agent harness is required");
  }
  const unsupported = targetAgents.find(
    (agent) => !SUPPORTED_HARNESSES.includes(agent),
  );
  if (unsupported) {
    throw new Error(
      `Unsupported agent harness: ${unsupported}. Choose one of: ${SUPPORTED_HARNESSES.join(", ")}`,
    );
  }
  const args = [
    "-y",
    "skills",
    "add",
    source,
    "--skill",
    SKILL_NAME,
    "--full-depth",
    "--global",
  ];
  for (const agent of targetAgents) args.push("--agent", agent);
  args.push("--yes");
  return args;
}

/** @param {string[]} parts */
export function formatCommand(parts) {
  return parts
    .map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions} options
 */
function defaultExecute(executable, args, options) {
  return execFileSync(executable, args, options);
}

/**
 * Install the MrScraper skill into one explicit harness or every detected
 * harness. The actual placement and linking are delegated to the public
 * `skills` CLI, just like Firecrawl's bootstrap.
 *
 * @param {{
 *   agent?: string,
 *   homeDirectory?: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   source?: string,
 *   execute?: typeof defaultExecute,
 *   dryRun?: boolean,
 *   log?: (message: string) => void,
 * }} [options]
 */
export function installMrscraperSkill(options = {}) {
  const {
    agent,
    homeDirectory = os.homedir(),
    environment = process.env,
    platform = process.platform,
    source = environment.MRSCRAPER_SKILL_SOURCE || SKILL_SOURCE,
    execute = defaultExecute,
    dryRun = false,
    log = console.log,
  } = options;

  const targets = agent
    ? HARNESS_DEFINITIONS.filter((definition) => definition.name === agent)
    : detectInstalledHarnesses(homeDirectory);

  if (agent && targets.length === 0) {
    throw new Error(
      `Unsupported agent harness: ${agent}. Choose one of: ${SUPPORTED_HARNESSES.join(", ")}`,
    );
  }

  if (targets.length === 0) {
    log(
      "No supported agent harnesses were detected. Install one first or pass `--agent <name>` explicitly.",
    );
    return { targets: [], commands: [] };
  }

  const command = {
    executable: npxExecutable(platform),
    args: buildSkillsInstallArgs(
      targets.map(({ name }) => name),
      source,
    ),
  };
  const rendered = formatCommand([command.executable, ...command.args]);
  const targetLabels = targets.map(({ label }) => label).join(", ");

  if (dryRun) {
    log(`Would install the MrScraper skill for ${targetLabels}: ${rendered}`);
  } else {
    log(`Installing the MrScraper skill for ${targetLabels}…`);
    execute(command.executable, command.args, {
      stdio: "inherit",
      env: cleanNpmEnvironment(environment),
    });
  }

  return {
    targets: targets.map(({ name }) => name),
    commands: [
      {
        command: command.executable,
        args: command.args,
      },
    ],
  };
}
