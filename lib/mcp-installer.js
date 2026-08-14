import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { parseDocument } from "yaml";

import {
  HARNESS_DEFINITIONS,
  SUPPORTED_HARNESSES,
  cleanNpmEnvironment,
  detectInstalledHarnesses,
  formatCommand,
} from "./skills-installer.js";

export const MCP_SERVER_NAME = "mrscraper";
export const MCP_SERVER_URL = "https://mcp.mrscraper.com/mcp";
export const MCP_REMOTE_BRIDGE_PACKAGE_SPEC = "mcp-remote@latest";
// Kept as a public constant for callers that explicitly self-host the stdio
// package. The normal bootstrap connects to MCP_SERVER_URL instead.
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

/**
 * Update one YAML property while preserving unrelated values and comments.
 * Hermes keeps MCP servers in config.yaml, and its interactive `mcp add`
 * command is intentionally not used because it probes and prompts.
 * @param {string} file
 * @param {(string | number)[]} propertyPath
 * @param {unknown} value
 */
export function updateYamlConfig(file, propertyPath, value) {
  let source = "";
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const document = parseDocument(source);
  if (document.errors.length > 0) {
    const detail = document.errors.map(({ message }) => message).join("; ");
    throw new Error(
      `Cannot update invalid YAML configuration ${file}${detail ? ` (${detail})` : ""}`,
    );
  }
  const root = document.toJS();
  if (root !== null && (typeof root !== "object" || Array.isArray(root))) {
    throw new Error(
      `Cannot update invalid YAML configuration ${file} (root must be a mapping)`,
    );
  }

  document.setIn(propertyPath, value);
  writeConfigAtomically(file, document.toString({ lineWidth: 0 }));
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
function grokConfigPath(homeDirectory, environment) {
  const configured = environment.GROK_HOME?.trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(homeDirectory, ".grok");
  return path.join(root, "config.toml");
}

/**
 * @param {string} homeDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
function hermesConfigPath(homeDirectory, environment) {
  const configured = environment.HERMES_HOME?.trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(homeDirectory, ".hermes");
  return path.join(root, "config.yaml");
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

/** @param {string} serverUrl */
function remoteMcpEntry(serverUrl) {
  return { url: serverUrl };
}

/** @param {string} packageSpec */
function localMcpEntry(packageSpec) {
  return { command: "npx", args: ["-y", packageSpec] };
}

/**
 * Grok Build supports Streamable HTTP but does not currently expose native MCP
 * OAuth configuration. Its own documentation recommends an stdio bridge for
 * OAuth-protected hosted servers.
 * @param {string} serverUrl
 * @param {string} bridgePackageSpec
 */
function grokRemoteMcpEntry(serverUrl, bridgePackageSpec) {
  return {
    command: "npx",
    args: ["-y", bridgePackageSpec, serverUrl, "--transport", "http-only"],
    enabled: true,
  };
}

/** @param {unknown} value */
function tomlString(value) {
  return JSON.stringify(String(value));
}

/**
 * Replace only Grok's MrScraper table and preserve every unrelated TOML line.
 * @param {string} file
 * @param {{ command: string, args: string[], enabled: boolean }} entry
 */
export function updateGrokMcpConfig(file, entry) {
  let source = "";
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const header = `[mcp_servers.${MCP_SERVER_NAME}]`;
  const block = [
    header,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    `enabled = ${entry.enabled ? "true" : "false"}`,
  ];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === header);

  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[{1,2}[^\]]/.test(lines[end])) {
      end += 1;
    }
    lines.splice(start, end - start, ...block);
  } else {
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(...block);
  }

  writeConfigAtomically(file, `${lines.join("\n")}\n`);
  return file;
}

/** @param {string} value */
function normalizeMcpServerUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid MrScraper MCP server URL: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("MrScraper MCP server URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("MrScraper MCP server URL must not contain credentials");
  }
  if (parsed.hash) {
    throw new Error("MrScraper MCP server URL must not contain a fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new Error("MrScraper MCP server URL must use HTTPS unless it is loopback");
  }
  return parsed.toString();
}

/**
 * Connect one explicit harness or every detected harness to the hosted MCP
 * endpoint, or register the local stdio package when explicitly requested.
 * Credentials are intentionally absent from client configuration.
 *
 * @param {{
 *   agent?: string,
 *   homeDirectory?: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   local?: boolean,
 *   packageSpec?: string,
 *   serverUrl?: string,
 *   bridgePackageSpec?: string,
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
    local = false,
    packageSpec = environment.MRSCRAPER_MCP_PACKAGE_SPEC || MCP_PACKAGE_SPEC,
    serverUrl = normalizeMcpServerUrl(
      environment.MRSCRAPER_MCP_URL || MCP_SERVER_URL,
    ),
    bridgePackageSpec =
      environment.MRSCRAPER_MCP_REMOTE_PACKAGE_SPEC ||
      MCP_REMOTE_BRIDGE_PACKAGE_SPEC,
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
  const connectionDescription = local
    ? formatCommand(["npx", "-y", packageSpec])
    : serverUrl;
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
        `Would connect ${clientLabel} to MrScraper MCP in ${file}: ${connectionDescription}`,
      );
      return;
    }
    updateJsonConfig(file, propertyPath, entry);
    log(`Connected ${clientLabel} to MrScraper MCP in ${file}.`);
  };
  const writeYamlEntry = (clientLabel, file, propertyPath, entry) => {
    files.push(file);
    if (dryRun) {
      log(
        `Would connect ${clientLabel} to MrScraper MCP in ${file}: ${connectionDescription}`,
      );
      return;
    }
    updateYamlConfig(file, propertyPath, entry);
    log(`Connected ${clientLabel} to MrScraper MCP in ${file}.`);
  };
  const writeGrokEntry = (file, entry) => {
    files.push(file);
    if (dryRun) {
      log(
        `Would connect Grok Build to MrScraper MCP in ${file}: ${formatCommand([entry.command, ...entry.args])}`,
      );
      return;
    }
    updateGrokMcpConfig(file, entry);
    log(`Connected Grok Build to MrScraper MCP in ${file}.`);
  };

  for (const target of targets) {
    if (target.name === "codex") {
      runCommand(
        "connect Codex to MrScraper MCP",
        platformCommand(platform, "codex"),
        local
          ? ["mcp", "add", MCP_SERVER_NAME, "--", "npx", "-y", packageSpec]
          : ["mcp", "add", MCP_SERVER_NAME, "--url", serverUrl],
      );
      continue;
    }

    if (target.name === "grok") {
      writeGrokEntry(
        grokConfigPath(homeDirectory, environment),
        local
          ? { ...localMcpEntry(packageSpec), enabled: true }
          : grokRemoteMcpEntry(serverUrl, bridgePackageSpec),
      );
      continue;
    }

    if (target.name === "hermes") {
      writeYamlEntry(
        "Hermes Agent",
        hermesConfigPath(homeDirectory, environment),
        ["mcp_servers", MCP_SERVER_NAME],
        local
          ? localMcpEntry(packageSpec)
          : { ...remoteMcpEntry(serverUrl), auth: "oauth" },
      );
      continue;
    }

    if (target.name === "claude-code") {
      writeEntry(
        "Claude Code",
        claudeConfigPath(homeDirectory, environment),
        ["mcpServers", MCP_SERVER_NAME],
        local
          ? localMcpEntry(packageSpec)
          : { type: "http", ...remoteMcpEntry(serverUrl) },
      );
      continue;
    }

    if (target.name === "cursor") {
      writeEntry(
        "Cursor",
        cursorConfigPath(homeDirectory),
        ["mcpServers", MCP_SERVER_NAME],
        local ? localMcpEntry(packageSpec) : remoteMcpEntry(serverUrl),
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
        local
          ? v2
            ? {
                type: "local",
                command: ["npx", "-y", packageSpec],
                disabled: false,
              }
            : {
                type: "local",
                command: ["npx", "-y", packageSpec],
                enabled: true,
              }
          : v2
          ? {
              type: "remote",
              url: serverUrl,
              disabled: false,
            }
          : {
              type: "remote",
              url: serverUrl,
              enabled: true,
            },
      );
      continue;
    }

    if (target.name === "openclaw") {
      runCommand(
        "connect OpenClaw to MrScraper MCP",
        platformCommand(platform, "openclaw"),
        [
          "mcp",
          "set",
          MCP_SERVER_NAME,
          JSON.stringify(
            local
              ? localMcpEntry(packageSpec)
              : {
                  url: serverUrl,
                  transport: "streamable-http",
                  auth: "oauth",
                },
          ),
        ],
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
        local
          ? localMcpEntry(packageSpec)
          : { ...remoteMcpEntry(serverUrl), auth: "oauth" },
      );
      continue;
    }

    if (target.name === "omp") {
      writeEntry(
        "Oh My Pi",
        path.join(ompAgentDirectory(homeDirectory, environment), "mcp.json"),
        ["mcpServers", MCP_SERVER_NAME],
        local
          ? { type: "stdio", ...localMcpEntry(packageSpec) }
          : { type: "http", ...remoteMcpEntry(serverUrl) },
      );
    }
  }

  return {
    targets: targets.map(({ name }) => name),
    commands,
    files,
  };
}
