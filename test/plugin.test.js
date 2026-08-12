import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);
const pluginJson = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, ".codex-plugin", "plugin.json"),
    "utf8",
  ),
);
const marketplaceJson = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "examples", "marketplace.json"),
    "utf8",
  ),
);

test("repository is a version-aligned skills-only Codex plugin", () => {
  assert.equal(pluginJson.name, "mrscraper-cli");
  assert.equal(pluginJson.version, packageJson.version);
  assert.equal(pluginJson.skills, "./skills/");
  assert.equal(pluginJson.interface.displayName, "MrScraper");
  assert.deepEqual(pluginJson.interface.capabilities, ["Read", "Write"]);
  assert.ok(Array.isArray(pluginJson.interface.defaultPrompt));
  assert.ok(pluginJson.interface.defaultPrompt.length > 0);
  assert.ok(pluginJson.interface.defaultPrompt.length <= 3);
  assert.equal("mcpServers" in pluginJson, false);
  assert.equal("apps" in pluginJson, false);
});

test("local marketplace example points to the plugin checkout", () => {
  const entry = marketplaceJson.plugins.find(
    ({ name }) => name === pluginJson.name,
  );

  assert.ok(entry);
  assert.deepEqual(entry.source, {
    source: "local",
    path: "./plugins/mrscraper-cli",
  });
  assert.deepEqual(entry.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry.category, pluginJson.interface.category);
});
