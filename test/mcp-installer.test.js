import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MCP_PACKAGE_SPEC,
  installMrscraperMcp,
  updateJsonConfig,
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
    ".config/opencode",
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
    "opencode",
    "pi",
    "omp",
  ]);
  assert.deepEqual(commands, [
    {
      command: "codex",
      args: ["mcp", "add", "mrscraper", "--", "npx", "-y", MCP_PACKAGE_SPEC],
    },
    {
      command: "grok",
      args: ["mcp", "add", "mrscraper", "--", "npx", "-y", MCP_PACKAGE_SPEC],
    },
    {
      command: "pi",
      args: ["install", "npm:pi-mcp-adapter"],
    },
  ]);

  const files = [
    path.join(homeDirectory, ".claude.json"),
    path.join(homeDirectory, ".cursor", "mcp.json"),
    path.join(homeDirectory, ".config", "opencode", "opencode.json"),
    path.join(homeDirectory, ".pi", "agent", "mcp.json"),
    path.join(homeDirectory, ".omp", "agent", "mcp.json"),
  ];
  for (const file of files) {
    const serialized = fs.readFileSync(file, "utf8");
    assert.match(serialized, /@mrscraper\/mcp@latest/);
    assert.doesNotMatch(serialized, /API_KEY|api.key|token|auth/i);
  }

  assert.deepEqual(readJson(files[0]).mcpServers.mrscraper, {
    command: "npx",
    args: ["-y", MCP_PACKAGE_SPEC],
  });
  assert.deepEqual(readJson(files[2]).mcp.mrscraper, {
    type: "local",
    command: ["npx", "-y", MCP_PACKAGE_SPEC],
    enabled: true,
  });
  assert.equal(readJson(files[4]).mcpServers.mrscraper.type, "stdio");
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
  assert.match(updated, /"disabled": false/);
});

test("an explicit package source override reaches client configuration", (t) => {
  const homeDirectory = temporaryHome(t);
  const packageSpec = "/tmp/mrscraper-mcp.tgz";

  installMrscraperMcp({
    agent: "cursor",
    homeDirectory,
    environment: { MRSCRAPER_MCP_PACKAGE_SPEC: packageSpec },
    log: () => {},
  });

  assert.deepEqual(
    readJson(path.join(homeDirectory, ".cursor", "mcp.json")).mcpServers
      .mrscraper.args,
    ["-y", packageSpec],
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
  assert.match(messages.join("\n"), /Would register MrScraper MCP for Cursor/);
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
    command: "npx",
    args: ["-y", MCP_PACKAGE_SPEC],
  });

  assert.equal(readJson(file).mcpServers.existing.command, "existing");
  assert.equal(readJson(file).mcpServers.mrscraper.command, "npx");
});
