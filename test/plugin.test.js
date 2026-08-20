import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readRepositoryJson(...segments) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8"),
  );
}

const packageJson = readRepositoryJson("package.json");
const codexPluginJson = readRepositoryJson(".codex-plugin", "plugin.json");
const claudePluginJson = readRepositoryJson(".claude-plugin", "plugin.json");
const cursorPluginJson = readRepositoryJson(".cursor-plugin", "plugin.json");
const codexMarketplaceJson = readRepositoryJson("examples", "marketplace.json");
const claudeMarketplaceJson = readRepositoryJson(
  ".claude-plugin",
  "marketplace.json",
);
const cursorMarketplaceJson = readRepositoryJson(
  ".cursor-plugin",
  "marketplace.json",
);

function assertSkillsOnly(pluginJson) {
  assert.equal(pluginJson.name, "mrscraper-cli");
  assert.equal(pluginJson.version, packageJson.version);
  assert.equal(pluginJson.skills, "./skills/");
  assert.equal("mcpServers" in pluginJson, false);
  assert.equal("hooks" in pluginJson, false);
  assert.equal("agents" in pluginJson, false);
  assert.equal("commands" in pluginJson, false);
}

function findMarketplaceEntry(marketplaceJson, pluginJson) {
  return marketplaceJson.plugins.find(({ name }) => name === pluginJson.name);
}

test("repository is a version-aligned skills-only Codex plugin", () => {
  assertSkillsOnly(codexPluginJson);
  assert.equal(codexPluginJson.interface.displayName, "MrScraper");
  assert.ok(codexPluginJson.interface.shortDescription.length <= 30);
  assert.deepEqual(codexPluginJson.interface.capabilities, ["Read", "Write"]);
  assert.ok(Array.isArray(codexPluginJson.interface.defaultPrompt));
  assert.ok(codexPluginJson.interface.defaultPrompt.length > 0);
  assert.ok(codexPluginJson.interface.defaultPrompt.length <= 3);
  assert.equal("apps" in codexPluginJson, false);
});

test("local marketplace example points to the plugin checkout", () => {
  const entry = findMarketplaceEntry(codexMarketplaceJson, codexPluginJson);

  assert.ok(entry);
  assert.deepEqual(entry.source, {
    source: "local",
    path: "./plugins/mrscraper-cli",
  });
  assert.deepEqual(entry.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry.category, codexPluginJson.interface.category);
});

test("repository is a version-aligned skills-only Claude Code plugin", () => {
  assertSkillsOnly(claudePluginJson);
  assert.equal(claudePluginJson.displayName, "MrScraper");
  assert.equal(
    claudePluginJson.$schema,
    "https://json.schemastore.org/claude-code-plugin-manifest.json",
  );
});

test("Claude Code marketplace indexes the repository-root plugin", () => {
  const entry = findMarketplaceEntry(claudeMarketplaceJson, claudePluginJson);

  assert.equal(claudeMarketplaceJson.name, "mrscraper");
  assert.ok(entry);
  assert.equal(entry.source, ".");
  assert.equal(path.resolve(repositoryRoot, entry.source), repositoryRoot);
});

test("repository is a version-aligned skills-only Cursor plugin", () => {
  assertSkillsOnly(cursorPluginJson);
  assert.equal(cursorPluginJson.displayName, "MrScraper");
  assert.equal(cursorPluginJson.publisher, "MrScraper");
  assert.equal(cursorPluginJson.logo, "assets/mrscraper.jpeg");
  assert.equal(
    fs.existsSync(path.join(repositoryRoot, cursorPluginJson.logo)),
    true,
  );
});

test("Cursor marketplace indexes the repository-root plugin", () => {
  const entry = findMarketplaceEntry(cursorMarketplaceJson, cursorPluginJson);

  assert.equal(cursorMarketplaceJson.name, "mrscraper");
  assert.ok(entry);
  assert.equal(entry.source, ".");
  assert.equal(path.resolve(repositoryRoot, entry.source), repositoryRoot);
});

test("all native plugins expose the same canonical skill pack", () => {
  const expectedSkills = [
    "mrscraper",
    "mrscraper-fetch",
    "mrscraper-scrape",
    "mrscraper-serp",
  ];
  const actualSkills = fs
    .readdirSync(path.join(repositoryRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) =>
      fs.existsSync(path.join(repositoryRoot, "skills", name, "SKILL.md")),
    )
    .sort();

  assert.deepEqual(actualSkills, expectedSkills.sort());
  for (const pluginJson of [
    codexPluginJson,
    claudePluginJson,
    cursorPluginJson,
  ]) {
    assert.equal(
      path.resolve(repositoryRoot, pluginJson.skills),
      path.join(repositoryRoot, "skills"),
    );
  }
});
