import assert from "node:assert/strict";
import fs from "node:fs";

const expectedPackage = "@mrscraper/mcp@latest";
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
  const command = Array.isArray(value.command)
    ? value.command
    : [value.command, ...(value.args || [])];
  assert.deepEqual(command, ["npx", "-y", expectedPackage]);
}
