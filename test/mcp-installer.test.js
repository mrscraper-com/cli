import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  MCP_PACKAGE_SPEC,
  MCP_REMOTE_BRIDGE_PACKAGE_SPEC,
  MCP_SERVER_URL,
  installMrscraperMcp,
  updateJsonConfig,
  updateYamlConfig,
} from "../lib/mcp-installer.js";

function temporaryHome(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-mcp-install-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("installs MCP entries for every detected harness without embedding credentials", (t) => {
  const homeDirectory = temporaryHome(t);
  for (const directory of [
    ".claude",
    ".cursor",
    ".codex",
    ".grok",
    ".hermes",
    ".config/opencode",
    ".openclaw",
    ".pi/agent",
    ".omp",
  ]) {
    fs.mkdirSync(path.join(homeDirectory, directory), { recursive: true });
  }

  const commands = [];
  const result = installMrscraperMcp({
    homeDirectory,
    environment: { PATH: "/test/bin" },
    getOpenCodeVersion: () => "1.18.2",
    execute: (command, args) => commands.push({ command, args }),
    log: () => {},
  });

  assert.deepEqual(result.targets, [
    "claude-code",
    "cursor",
    "codex",
    "grok",
    "hermes",
    "opencode",
    "openclaw",
    "pi",
    "omp",
  ]);
  assert.deepEqual(commands, [
    {
      command: "codex",
      args: ["mcp", "add", "mrscraper", "--url", MCP_SERVER_URL],
    },
    {
      command: "openclaw",
      args: [
        "mcp",
        "set",
        "mrscraper",
        JSON.stringify({
          url: MCP_SERVER_URL,
          transport: "streamable-http",
          auth: "oauth",
        }),
      ],
    },
    {
      command: "pi",
      args: ["install", "npm:pi-mcp-adapter"],
    },
  ]);

  const claudeFile = path.join(homeDirectory, ".claude.json");
  const cursorFile = path.join(homeDirectory, ".cursor", "mcp.json");
  const grokFile = path.join(homeDirectory, ".grok", "config.toml");
  const hermesFile = path.join(homeDirectory, ".hermes", "config.yaml");
  const opencodeFile = path.join(
    homeDirectory,
    ".config",
    "opencode",
    "opencode.json",
  );
  const piFile = path.join(homeDirectory, ".pi", "agent", "mcp.json");
  const ompFile = path.join(homeDirectory, ".omp", "agent", "mcp.json");
  for (const file of [claudeFile, cursorFile, opencodeFile, piFile, ompFile]) {
    const serialized = fs.readFileSync(file, "utf8");
    assert.match(serialized, /https:\/\/mcp\.mrscraper\.com\/mcp/);
    assert.doesNotMatch(
      serialized,
      /MRSCRAPER_API_KEY|MRSCRAPER_API_TOKEN|Bearer|api_key/i,
    );
  }
  const grokSource = fs.readFileSync(grokFile, "utf8");
  assert.match(grokSource, /\[mcp_servers\.mrscraper\]/);
  assert.match(grokSource, /mcp-remote@latest/);
  assert.match(grokSource, /https:\/\/mcp\.mrscraper\.com\/mcp/);
  const hermesSource = fs.readFileSync(hermesFile, "utf8");
  assert.match(hermesSource, /https:\/\/mcp\.mrscraper\.com\/mcp/);
  assert.doesNotMatch(
    hermesSource,
    /MRSCRAPER_API_KEY|MRSCRAPER_API_TOKEN|Bearer|api_key/i,
  );

  assert.deepEqual(readJson(claudeFile).mcpServers.mrscraper, {
    type: "http",
    url: MCP_SERVER_URL,
  });
  assert.deepEqual(parseYaml(hermesSource).mcp_servers.mrscraper, {
    url: MCP_SERVER_URL,
    auth: "oauth",
  });
  assert.deepEqual(readJson(opencodeFile).mcp.mrscraper, {
    type: "remote",
    url: MCP_SERVER_URL,
    enabled: true,
  });
  assert.deepEqual(readJson(piFile).mcpServers.mrscraper, {
    url: MCP_SERVER_URL,
    auth: "oauth",
  });
  assert.deepEqual(readJson(ompFile).mcpServers.mrscraper, {
    type: "http",
    url: MCP_SERVER_URL,
  });
});

test("supports OpenCode v2 and preserves comments and unrelated config", (t) => {
  const homeDirectory = temporaryHome(t);
  const configDirectory = path.join(homeDirectory, ".config", "opencode");
  fs.mkdirSync(configDirectory, { recursive: true });
  const file = path.join(configDirectory, "opencode.jsonc");
  fs.writeFileSync(
    file,
    '{\n  // keep this setting\n  "model": "example/model"\n}\n',
  );

  installMrscraperMcp({
    agent: "opencode",
    homeDirectory,
    environment: {},
    getOpenCodeVersion: () => "2.0.0",
    log: () => {},
  });

  const updated = fs.readFileSync(file, "utf8");
  assert.match(updated, /keep this setting/);
  assert.match(updated, /example\/model/);
  assert.match(updated, /"servers"/);
  assert.match(updated, /"type": "remote"/);
  assert.match(updated, /https:\/\/mcp\.mrscraper\.com\/mcp/);
  assert.match(updated, /"disabled": false/);
});

test("Hermes MCP registration honors HERMES_HOME and preserves YAML", (t) => {
  const homeDirectory = temporaryHome(t);
  const hermesHome = path.join(homeDirectory, "profiles", "work");
  fs.mkdirSync(hermesHome, { recursive: true });
  const file = path.join(hermesHome, "config.yaml");
  fs.writeFileSync(
    file,
    [
      "# keep this setting",
      "model: example/model",
      "mcp_servers:",
      "  existing:",
      "    command: existing",
      "",
    ].join("\n"),
  );

  installMrscraperMcp({
    agent: "hermes",
    homeDirectory,
    environment: { HERMES_HOME: hermesHome },
    log: () => {},
  });

  const updated = fs.readFileSync(file, "utf8");
  const parsed = parseYaml(updated);
  assert.match(updated, /keep this setting/);
  assert.equal(parsed.model, "example/model");
  assert.equal(parsed.mcp_servers.existing.command, "existing");
  assert.deepEqual(parsed.mcp_servers.mrscraper, {
    url: MCP_SERVER_URL,
    auth: "oauth",
  });
});

test("OpenClaw MCP registration uses its scriptable registry command", (t) => {
  const homeDirectory = temporaryHome(t);
  const calls = [];

  const result = installMrscraperMcp({
    agent: "openclaw",
    homeDirectory,
    environment: { PATH: "/test/bin" },
    execute: (command, args, options) =>
      calls.push({ command, args, options }),
    log: () => {},
  });

  assert.deepEqual(result.targets, ["openclaw"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "openclaw");
  assert.deepEqual(calls[0].args, [
    "mcp",
    "set",
    "mrscraper",
    JSON.stringify({
      url: MCP_SERVER_URL,
      transport: "streamable-http",
      auth: "oauth",
    }),
  ]);
  assert.equal(calls[0].options.stdio, "inherit");
});

test("an explicit hosted endpoint override reaches client configuration", (t) => {
  const homeDirectory = temporaryHome(t);
  const serverUrl = "https://mcp.dev.mrscraper.com/mcp";

  installMrscraperMcp({
    agent: "cursor",
    homeDirectory,
    environment: { MRSCRAPER_MCP_URL: serverUrl },
    log: () => {},
  });

  assert.equal(
    readJson(path.join(homeDirectory, ".cursor", "mcp.json")).mcpServers
      .mrscraper.url,
    serverUrl,
  );
});

test("local mode registers the self-hosted stdio package", (t) => {
  const homeDirectory = temporaryHome(t);
  const calls = [];

  installMrscraperMcp({
    agent: "cursor",
    local: true,
    homeDirectory,
    environment: {},
    log: () => {},
  });
  installMrscraperMcp({
    agent: "codex",
    local: true,
    homeDirectory,
    environment: {},
    execute: (command, args) => calls.push({ command, args }),
    log: () => {},
  });

  assert.deepEqual(
    readJson(path.join(homeDirectory, ".cursor", "mcp.json")).mcpServers
      .mrscraper,
    { command: "npx", args: ["-y", MCP_PACKAGE_SPEC] },
  );
  assert.deepEqual(calls, [
    {
      command: "codex",
      args: ["mcp", "add", "mrscraper", "--", "npx", "-y", MCP_PACKAGE_SPEC],
    },
  ]);
});

test("Grok registration preserves unrelated TOML and replaces its managed table", (t) => {
  const homeDirectory = temporaryHome(t);
  const file = path.join(homeDirectory, ".grok", "config.toml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "# keep this setting",
      '[models]',
      'default = "grok-build"',
      "",
      "[mcp_servers.mrscraper]",
      'command = "old"',
      "",
      "[mcp_servers.existing]",
      'command = "existing"',
      "",
    ].join("\n"),
  );

  installMrscraperMcp({
    agent: "grok",
    homeDirectory,
    environment: {},
    log: () => {},
  });

  const updated = fs.readFileSync(file, "utf8");
  assert.match(updated, /keep this setting/);
  assert.match(updated, /default = "grok-build"/);
  assert.match(updated, /\[mcp_servers\.existing\]/);
  assert.match(updated, /command = "existing"/);
  assert.match(updated, new RegExp(MCP_REMOTE_BRIDGE_PACKAGE_SPEC));
  assert.match(updated, /https:\/\/mcp\.mrscraper\.com\/mcp/);
  assert.doesNotMatch(updated, /command = "old"/);
});

test("hosted endpoint overrides reject insecure non-loopback URLs", (t) => {
  const homeDirectory = temporaryHome(t);
  assert.throws(
    () =>
      installMrscraperMcp({
        agent: "cursor",
        homeDirectory,
        environment: { MRSCRAPER_MCP_URL: "http://mcp.example.com/mcp" },
        log: () => {},
      }),
    /must use HTTPS/,
  );
});

test("dry-run reports actions without executing commands or writing files", (t) => {
  const homeDirectory = temporaryHome(t);
  const messages = [];
  let executed = false;

  const result = installMrscraperMcp({
    agent: "cursor",
    homeDirectory,
    dryRun: true,
    execute: () => {
      executed = true;
    },
    log: (message) => messages.push(message),
  });

  assert.equal(executed, false);
  assert.equal(
    fs.existsSync(path.join(homeDirectory, ".cursor", "mcp.json")),
    false,
  );
  assert.deepEqual(result.targets, ["cursor"]);
  assert.match(messages.join("\n"), /Would connect Cursor to MrScraper MCP/);
});

test("invalid client JSON is rejected without overwriting it", (t) => {
  const homeDirectory = temporaryHome(t);
  const file = path.join(homeDirectory, ".cursor", "mcp.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ invalid\n");

  assert.throws(
    () =>
      installMrscraperMcp({
        agent: "cursor",
        homeDirectory,
        log: () => {},
      }),
    /Cannot update invalid JSON configuration/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "{ invalid\n");
});

test("invalid Hermes YAML is rejected without overwriting it", (t) => {
  const homeDirectory = temporaryHome(t);
  const file = path.join(homeDirectory, "config.yaml");
  fs.writeFileSync(file, "mcp_servers: [\n");

  assert.throws(
    () =>
      updateYamlConfig(file, ["mcp_servers", "mrscraper"], {
        command: "npx",
      }),
    /Cannot update invalid YAML configuration/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "mcp_servers: [\n");
});

test("updateJsonConfig replaces only the requested server entry", (t) => {
  const homeDirectory = temporaryHome(t);
  const file = path.join(homeDirectory, "mcp.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        existing: { command: "existing" },
        mrscraper: { command: "old" },
      },
    }),
  );

  updateJsonConfig(file, ["mcpServers", "mrscraper"], {
    type: "http",
    url: MCP_SERVER_URL,
  });

  assert.equal(readJson(file).mcpServers.existing.command, "existing");
  assert.equal(readJson(file).mcpServers.mrscraper.type, "http");
  assert.equal(readJson(file).mcpServers.mrscraper.url, MCP_SERVER_URL);
});
