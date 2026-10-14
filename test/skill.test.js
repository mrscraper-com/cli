import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_NAMES } from "../lib/skills-installer.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillsRoot = path.join(repositoryRoot, "skills");
const skills = Object.fromEntries(
  SKILL_NAMES.map((name) => [
    name,
    fs.readFileSync(path.join(skillsRoot, name, "SKILL.md"), "utf8"),
  ]),
);

test("the repository ships exactly the skills the installer requests", () => {
  const discovered = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(discovered, [...SKILL_NAMES].sort());
});

test("every skill has complete, minimal, harness-neutral metadata", () => {
  for (const [name, skill] of Object.entries(skills)) {
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${name} must start with YAML frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
    assert.match(frontmatter[1], /^description: \S.*\S[.!?]$/m);
    const metadataValues = Object.fromEntries(
      [...frontmatter[1].matchAll(/^(name|description): (.+)$/gm)].map(
        ([, key, value]) => [key, value],
      ),
    );
    assert.ok(
      metadataValues.description.length <= 350,
      `${name} description must stay discovery-focused`,
    );
    for (const [key, value] of Object.entries(metadataValues)) {
      const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
      assert.equal(value, normalized, `${name} ${key} must be normalized`);
    }
    assert.deepEqual(Object.keys(metadataValues).sort(), ["description", "name"]);
    assert.doesNotMatch(frontmatter[1], /^(?!name:|description:|\s).+:/m);
    assert.doesNotMatch(skill, /\bTODO\b/);
    assert.doesNotMatch(
      skill,
      /^\s*(?:[-*]|\d+\.) [a-z]/m,
      `${name} list items must begin with a capital letter`,
    );
    assert.ok(skill.split("\n").length < 500, `${name} must stay concise`);
    assert.equal(
      fs.existsSync(path.join(skillsRoot, name, "agents", "openai.yaml")),
      false,
    );
  }
});

test("skills link only to skills that ship", () => {
  for (const [name, skill] of Object.entries(skills)) {
    for (const [, target] of skill.matchAll(/\]\(\.\.\/([^/)]+)\/SKILL\.md\)/g)) {
      assert.ok(SKILL_NAMES.includes(target), `${name} links to missing ${target}`);
    }
  }
});

test("skill commands run only CLI commands that exist", () => {
  const supportedCommands = new Set([
    "--version",
    "auth",
    "init",
    "login",
    "logout",
    "scraper-api",
    "setup",
    "status",
    "web-search",
  ]);
  const documentedCommands = Object.values(skills).flatMap((skill) =>
    [...skill.matchAll(/^(?:\s*)mrscraper\s+([^\s"\\]+)/gm)].map((match) => match[1]),
  );

  assert.deepEqual(
    [...new Set(documentedCommands.filter((name) => !supportedCommands.has(name)))],
    [],
  );
  for (const command of ["scraper-api", "web-search", "status"]) {
    assert.ok(documentedCommands.includes(command), `missing ${command} example`);
  }
});

test("skills remain repository-hosted rather than npm-bundled", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(packageJson.files.includes("skills"), false);
});
