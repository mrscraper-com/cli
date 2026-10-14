import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SKILL_NAMES } from "../lib/skills-installer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(root, "skills");

test("installer skills exist, have matching metadata, and resolve their relative references", () => {
  const discovered = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  assert.deepEqual(discovered, [...SKILL_NAMES].sort());
  for (const name of SKILL_NAMES) {
    const directory = path.join(skillsRoot, name);
    const text = fs.readFileSync(path.join(directory, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---`));
    for (const [, target] of text.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) {
      assert.ok(fs.existsSync(path.resolve(directory, target)), `${name}: ${target}`);
    }
  }
});

test("skill and README command examples resolve to supported CLI commands", () => {
  const docs = [fs.readFileSync(path.join(root, "README.md"), "utf8"), ...SKILL_NAMES.map((name) =>
    fs.readFileSync(path.join(skillsRoot, name, "SKILL.md"), "utf8"))];
  const commands = new Set(docs.flatMap((text) =>
    [...text.matchAll(/^mrscraper\s+([A-Za-z][A-Za-z-]*)/gm)].map(([, name]) => name)));
  assert.ok(commands.has("scraperAPI"));
  assert.ok(commands.has("webSearch"));
  assert.ok(commands.has("account"));
  for (const command of commands) {
    execFileSync(process.execPath, [path.join(root, "bin/mrscraper.js"), command, "--help"], { stdio: "pipe" });
  }
});

test("the skill pack remains repository-hosted and excluded from the npm package", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.files.includes("skills"), false);
});
