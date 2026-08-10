import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillPath = path.join(repositoryRoot, "skills", "mrscraper", "SKILL.md");
const skill = fs.readFileSync(skillPath, "utf8");

test("MrScraper skill has complete and minimal frontmatter", () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, "SKILL.md must start with YAML frontmatter");
  assert.match(frontmatter[1], /^name: mrscraper$/m);
  assert.match(frontmatter[1], /^description: \|$/m);
  assert.doesNotMatch(frontmatter[1], /^(?!name:|description:|\s).+:/m);
  assert.doesNotMatch(skill, /\bTODO\b/);
});

test("MrScraper skill documents only supported CLI command names", () => {
  const supportedCommands = new Set([
    "--version",
    "fetch",
    "init",
    "login",
    "logout",
    "rerun",
    "result",
    "results",
    "scrape",
    "serp",
    "status",
  ]);
  const documentedCommands = [
    ...skill.matchAll(/^mrscraper\s+([^\s]+)/gm),
  ].map((match) => match[1]);

  assert.ok(documentedCommands.length > 0);
  assert.deepEqual(
    [...new Set(documentedCommands.filter((name) => !supportedCommands.has(name)))],
    [],
  );
  for (const command of ["fetch", "scrape", "serp", "rerun", "results", "result", "status"]) {
    assert.ok(documentedCommands.includes(command), `missing ${command} example`);
  }
});

test("onboarding is remote guidance without local-agent metadata", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const metadataPath = path.join(
    repositoryRoot,
    "skills",
    "mrscraper",
    "agents",
    "openai.yaml",
  );

  assert.equal(packageJson.files.includes("skills"), false);
  assert.equal(fs.existsSync(metadataPath), false);
  assert.doesNotMatch(skill, /\bskills add\b/);
  assert.doesNotMatch(skill, /\bPath [A-F]\b/);
  assert.doesNotMatch(skill, /^## Get Credentials$/m);
  assert.match(skill, /Read this onboarding document directly/);
  assert.match(skill, /^## Authenticate$/m);
});
