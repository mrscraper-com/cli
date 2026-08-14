import assert from "node:assert/strict";
import fs from "node:fs";
import { parse as parseYaml } from "yaml";

const expectedUrl = "https://mcp.mrscraper.com/mcp";
const configurations = [
  ["/root/.claude.json", ["mcpServers", "mrscraper"]],
  ["/root/.cursor/mcp.json", ["mcpServers", "mrscraper"]],
  ["/root/.config/opencode/opencode.json", ["mcp", "mrscraper"]],
  ["/root/.pi/agent/mcp.json", ["mcpServers", "mrscraper"]],
  ["/root/.omp/agent/mcp.json", ["mcpServers", "mrscraper"]],
];

for (const [file, propertyPath] of configurations) {
  assert.equal(fs.existsSync(file), true, `${file} was not created`);
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /MRSCRAPER_API_KEY|MRSCRAPER_API_TOKEN/);
  let value = JSON.parse(source);
  for (const property of propertyPath) value = value[property];
  assert.equal(value.url, expectedUrl);
}

const hermesConfig = "/root/.hermes/config.yaml";
assert.equal(fs.existsSync(hermesConfig), true, `${hermesConfig} was not created`);
const hermesSource = fs.readFileSync(hermesConfig, "utf8");
assert.doesNotMatch(hermesSource, /MRSCRAPER_API_KEY|MRSCRAPER_API_TOKEN/);
const hermesEntry = parseYaml(hermesSource).mcp_servers.mrscraper;
assert.equal(hermesEntry.url, expectedUrl);
assert.equal(hermesEntry.auth, "oauth");

const grokConfig = "/root/.grok/config.toml";
assert.equal(fs.existsSync(grokConfig), true, `${grokConfig} was not created`);
const grokSource = fs.readFileSync(grokConfig, "utf8");
assert.match(grokSource, /\[mcp_servers\.mrscraper\]/);
assert.match(grokSource, /mcp-remote@latest/);
assert.match(grokSource, /https:\/\/mcp\.mrscraper\.com\/mcp/);
assert.doesNotMatch(grokSource, /MRSCRAPER_API_KEY|MRSCRAPER_API_TOKEN/);
