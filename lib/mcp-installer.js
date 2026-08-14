import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";

import {
  HARNESS_DEFINITIONS,
  SUPPORTED_HARNESSES,
  cleanNpmEnvironment,
  detectInstalledHarnesses,
  formatCommand,
} from "./skills-installer.js";

export const MCP_SERVER_NAME = "mrscraper";
export const MCP_PACKAGE_SPEC = "@mrscraper/mcp@latest";

const JSON_FORMATTING = Object.freeze({
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
});

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions} options
 */
function defaultExecute(executable, args, options) {
  return execFileSync(executable, args, options);
}

/** @param {string} file */
function readJsonConfig(file) {
  let source = "{}\n";
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!source.trim()) source = "{}\n";

  const errors = [];
  const value = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0 || !value || typeof value !== "object") {
    const detail = errors
      .map(({ error, offset }) => `${printParseErrorCode(error)} at ${offset}`)
      .join(", ");
    throw new Error(
      `Cannot update invalid JSON configuration ${file}${detail ? ` (${detail})` : ""}`,
    );
  }
  return { source, value };
}

/** @param {string} file @param {string} content */
function writeConfigAtomically(file, content) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Atomic rename normally removes the temporary path.
    }
  }
}

/**
 * Update one JSON/JSONC property while preserving unrelated content and
 * comments. Invalid files are never overwritten.
 * @param {string} file
 * @param {(string | number)[]} propertyPath
 * @param {unknown} value
 */
export function updateJsonConfig(file, propertyPath, value) {
  const { source } = readJsonConfig(file);
  const edits = modify(source, propertyPath, value, {
    formattingOptions: JSON_FORMATTING,
  });
  const updated = applyEdits(source, edits);
  writeConfigAtomically(
    file,
    updated.endsWith("\n") ? updated : `${updated}\n`,
  );
  return file;
}

/** @param {NodeJS.Platform} platform @param {string} command */
function platformCommand(platform, command) {
  return platform === "win32" ? `${command}.cmd` : command;
}

/**
 * @param {string} homeDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
function claudeConfigPath(homeDirectory, environment) {
  const configured = environment.CLAUDE_CONFIG_DIR?.trim();
  return configured
    ? path.join(path.resolve(configured), ".claude.json")
    : path.join(homeDirectory, ".claude.json");
}

/** @param {string} homeDirectory */
function cursorConfigPath(homeDirectory) {
  return path.join(homeDirectory, ".cursor", "mcp.json");
}

/**
 * @param {string} homeDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
function opencodeConfigPath(homeDirectory, environment) {
  const configured = environment.OPENCODE_CONFIG?.trim();
  if (configured) return path.resolve(configured);

  const xdgRoot = environment.XDG_CONFIG_HOME?.trim()
    ? path.resolve(environment.XDG_CONFIG_HOME)
    : path.join(homeDirectory, ".config");
  const candidates = [
    path.join(xdgRoot, "opencode", "opencode.json"),
    path.join(xdgRoot, "opencode", "opencode.jsonc"),
    path.join(homeDirectory, ".opencode", "opencode.json"),
    path.join(homeDirectory, ".opencode", "opencode.jsonc"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
  );
}

/**
 * OpenCode v2 moved servers from `mcp.<name>` to `mcp.servers.<name>`.
 * Existing config shape wins; otherwise use the installed major version.
 * @param {string} file
 * @param {() => string} getVersion
 */
function opencodeServerPath(file, getVersion) {
  const { value } = readJsonConfig(file);
  const mcp = value.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    if (
      mcp.servers &&
      typeof mcp.servers === "object" &&
      !Array.isArray(mcp.servers)
    ) {
      return ["mcp", "servers", MCP_SERVER_NAME];
    }
    if (Object.keys(mcp).length > 0) {
      return ["mcp", MCP_SERVER_NAME];
    }
  }

  let major = 1;
  try {
    major = Number.parseInt(String(getVersion()).trim().split(".")[0], 10);
  } catch {
    // A config-only installation defaults to the broadly deployed v1 shape.
  }
  return major >= 2
    ? ["mcp", "servers", MCP_SERVER_NAME]
    : ["mcp", MCP_SERVER_NAME];
}

/**
 * @param {string} homeDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
function piAgentDirectory(homeDirectory, environment) {
  const configured = environment.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(homeDirectory, ".pi", "agent");
}

/**
 * @param {string} homeDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
function ompAgentDirectory(homeDirectory, environment) {
  const configured = environment.OMP_AGENT_DIR?.trim();
  if (configured) return path.resolve(configured);

  const profile = (environment.OMP_PROFILE || environment.PI_PROFILE)?.trim();
  if (
    profile &&
    path.basename(profile) === profile &&
    ![".", ".."].includes(profile)
  ) {
    return path.join(homeDirectory, ".omp", "profiles", profile, "agent");
  }
  return path.join(homeDirectory, ".omp", "agent");
}

/** @param {string} packageSpec */
function standardMcpEntry(packageSpec) {
  return { command: "npx", args: ["-y", packageSpec] };
}

/**
 * Install the stdio MCP server into one explicit harness or every detected
 * harness. Credentials are intentionally absent from client configuration;
 * the server resolves ~/.mrscraper/auth.json at runtime.
 *
 * @param {{
 *   agent?: string,
 *   homeDirectory?: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   packageSpec?: string,
 *   execute?: typeof defaultExecute,
 *   getOpenCodeVersion?: () => string,
 *   dryRun?: boolean,
 *   log?: (message: string) => void,
 * }} [options]
 */
export function installMrscraperMcp(options = {}) {
  const {
    agent,
    homeDirectory = os.homedir(),
    environment = process.env,
    platform = process.platform,
    packageSpec = environment.MRSCRAPER_MCP_PACKAGE_SPEC || MCP_PACKAGE_SPEC,
    execute = defaultExecute,
    dryRun = false,
    log = console.log,
  } = options;
  const getOpenCodeVersion =
    options.getOpenCodeVersion ||
    (() =>
      String(
        execute(platformCommand(platform, "opencode"), ["--version"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          env: environment,
        }),
      ));

  const targets = agent
    ? HARNESS_DEFINITIONS.filter((definition) => definition.name === agent)
    : detectInstalledHarnesses(homeDirectory, environment);
  if (agent && targets.length === 0) {
    throw new Error(
      `Unsupported agent harness: ${agent}. Choose one of: ${SUPPORTED_HARNESSES.join(", ")}`,
    );
  }
  if (targets.length === 0) {
    log(
      "No supported MCP clients were detected. Install one first or pass `--agent <name>` explicitly.",
    );
    return { targets: [], commands: [], files: [] };
  }

  const commands = [];
  const files = [];
  const cleanEnvironment = cleanNpmEnvironment(environment);
  const runCommand = (label, command, args) => {
    commands.push({ command, args });
    const rendered = formatCommand([command, ...args]);
    if (dryRun) {
      log(`Would ${label}: ${rendered}`);
      return;
    }
    log(`${label}…`);
    execute(command, args, { stdio: "inherit", env: cleanEnvironment });
  };
  const writeEntry = (clientLabel, file, propertyPath, entry) => {
    files.push(file);
    if (dryRun) {
      log(
        `Would register MrScraper MCP for ${clientLabel} in ${file}: ${formatCommand(["npx", "-y", packageSpec])}`,
      );
      return;
    }
    updateJsonConfig(file, propertyPath, entry);
    log(`Registered MrScraper MCP for ${clientLabel} in ${file}.`);
  };

  for (const target of targets) {
    if (target.name === "codex") {
      runCommand(
        "register MrScraper MCP for Codex",
        platformCommand(platform, "codex"),
        ["mcp", "add", MCP_SERVER_NAME, "--", "npx", "-y", packageSpec],
      );
      continue;
    }

    if (target.name === "grok") {
      runCommand(
        "register MrScraper MCP for Grok Build",
        platformCommand(platform, "grok"),
        ["mcp", "add", MCP_SERVER_NAME, "--", "npx", "-y", packageSpec],
      );
      continue;
    }

    if (target.name === "claude-code") {
      writeEntry(
        "Claude Code",
        claudeConfigPath(homeDirectory, environment),
        ["mcpServers", MCP_SERVER_NAME],
        standardMcpEntry(packageSpec),
      );
      continue;
    }

    if (target.name === "cursor") {
      writeEntry(
        "Cursor",
        cursorConfigPath(homeDirectory),
        ["mcpServers", MCP_SERVER_NAME],
        standardMcpEntry(packageSpec),
      );
      continue;
    }

    if (target.name === "opencode") {
      const file = opencodeConfigPath(homeDirectory, environment);
      const propertyPath = opencodeServerPath(file, getOpenCodeVersion);
      const v2 = propertyPath.includes("servers");
      writeEntry(
        "OpenCode",
        file,
        propertyPath,
        v2
          ? {
              type: "local",
              command: ["npx", "-y", packageSpec],
              disabled: false,
            }
          : {
              type: "local",
              command: ["npx", "-y", packageSpec],
              enabled: true,
            },
      );
      continue;
    }

    if (target.name === "pi") {
      runCommand("install Pi's MCP adapter", platformCommand(platform, "pi"), [
        "install",
        "npm:pi-mcp-adapter",
      ]);
      writeEntry(
        "Pi",
        path.join(piAgentDirectory(homeDirectory, environment), "mcp.json"),
        ["mcpServers", MCP_SERVER_NAME],
        standardMcpEntry(packageSpec),
      );
      continue;
    }

    if (target.name === "omp") {
      writeEntry(
        "Oh My Pi",
        path.join(ompAgentDirectory(homeDirectory, environment), "mcp.json"),
        ["mcpServers", MCP_SERVER_NAME],
        { type: "stdio", ...standardMcpEntry(packageSpec) },
      );
    }
  }

  return {
    targets: targets.map(({ name }) => name),
    commands,
    files,
  };
}
