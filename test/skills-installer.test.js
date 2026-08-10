import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSkillsInstallArgs,
  cleanNpmEnvironment,
  detectInstalledHarnesses,
  installMrscraperSkill,
  npmExecutable,
  npxExecutable,
} from "../lib/skills-installer.js";

function temporaryHome(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-skills-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("detectInstalledHarnesses returns only harnesses present in the home directory", (t) => {
  const homeDirectory = temporaryHome(t);
  fs.mkdirSync(path.join(homeDirectory, ".codex"));
  fs.mkdirSync(path.join(homeDirectory, ".cursor"));
  fs.mkdirSync(path.join(homeDirectory, ".opencode"));
  fs.mkdirSync(path.join(homeDirectory, ".pi", "agent"), { recursive: true });
  fs.mkdirSync(path.join(homeDirectory, ".omp"));
  fs.writeFileSync(path.join(homeDirectory, ".claude"), "not a directory");

  assert.deepEqual(
    detectInstalledHarnesses(homeDirectory).map(({ name }) => name),
    ["cursor", "codex", "opencode", "pi", "omp"],
  );
});

test("OpenCode detection honors XDG_CONFIG_HOME", (t) => {
  const homeDirectory = temporaryHome(t);
  const xdgConfigHome = path.join(homeDirectory, "custom-config");
  fs.mkdirSync(path.join(xdgConfigHome, "opencode"), { recursive: true });

  assert.deepEqual(
    detectInstalledHarnesses(homeDirectory, {
      XDG_CONFIG_HOME: xdgConfigHome,
    }).map(({ name }) => name),
    ["opencode"],
  );
});

test("installMrscraperSkill targets every detected harness in one invocation", (t) => {
  const homeDirectory = temporaryHome(t);
  fs.mkdirSync(path.join(homeDirectory, ".cursor"));
  fs.mkdirSync(path.join(homeDirectory, ".codex"));
  const calls = [];

  const result = installMrscraperSkill({
    homeDirectory,
    environment: {
      PATH: "/test/bin",
      npm_config_cache: "/outer/cache",
      npm_execpath: "/outer/npm",
      INIT_CWD: "/outer/project",
      PROJECT_CWD: "/outer/project",
      KEEP_ME: "yes",
    },
    execute: (command, args, options) => calls.push({ command, args, options }),
    log: () => {},
  });

  assert.deepEqual(result.targets, ["cursor", "codex"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npx");
  assert.deepEqual(
    calls[0].args,
    buildSkillsInstallArgs(["cursor", "codex"]),
  );
  assert.deepEqual(result.commands, [
    { command: "npx", args: buildSkillsInstallArgs(["cursor", "codex"]) },
  ]);
  assert.equal(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.PATH, "/test/bin");
  assert.equal(calls[0].options.env.KEEP_ME, "yes");
  assert.equal(calls[0].options.env.npm_config_cache, undefined);
  assert.equal(calls[0].options.env.npm_execpath, undefined);
  assert.equal(calls[0].options.env.INIT_CWD, undefined);
  assert.equal(calls[0].options.env.PROJECT_CWD, undefined);
});

test("an explicit supported agent installs even when its detection directory is absent", (t) => {
  const homeDirectory = temporaryHome(t);
  const calls = [];

  const result = installMrscraperSkill({
    agent: "claude-code",
    homeDirectory,
    execute: (command, args) => calls.push({ command, args }),
    log: () => {},
  });

  assert.deepEqual(result.targets, ["claude-code"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, buildSkillsInstallArgs("claude-code"));
});

test("Oh My Pi installs through its supported standard-agent skills provider", (t) => {
  const homeDirectory = temporaryHome(t);
  const calls = [];
  const messages = [];

  const result = installMrscraperSkill({
    agent: "omp",
    homeDirectory,
    execute: (command, args) => calls.push({ command, args }),
    log: (message) => messages.push(message),
  });

  assert.deepEqual(result.targets, ["omp"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, buildSkillsInstallArgs("omp"));
  assert.match(calls[0].args.join(" "), /--agent cline/);
  assert.doesNotMatch(calls[0].args.join(" "), /--agent omp/);
  assert.match(messages.join("\n"), /standard ~\/.agents\/skills provider/);
});

test("no detected harness is a safe no-op", (t) => {
  const homeDirectory = temporaryHome(t);
  const messages = [];
  let executed = false;

  const result = installMrscraperSkill({
    homeDirectory,
    execute: () => {
      executed = true;
    },
    log: (message) => messages.push(message),
  });

  assert.deepEqual(result, { targets: [], commands: [] });
  assert.equal(executed, false);
  assert.match(messages.join("\n"), /No supported agent harnesses/);
});

test("dry-run renders the nested npx command without executing it", () => {
  const messages = [];
  let executed = false;

  installMrscraperSkill({
    agent: "codex",
    dryRun: true,
    execute: () => {
      executed = true;
    },
    log: (message) => messages.push(message),
  });

  assert.equal(executed, false);
  assert.match(
    messages.join("\n"),
    /npx -y skills add mrscraper-com\/cli --skill mrscraper --full-depth --global --agent codex --yes/,
  );
});

test("a development source override is passed to the skills installer", () => {
  const messages = [];

  installMrscraperSkill({
    agent: "codex",
    environment: { MRSCRAPER_SKILL_SOURCE: "/workspace" },
    dryRun: true,
    log: (message) => messages.push(message),
  });

  assert.match(messages.join("\n"), /skills add \/workspace --skill mrscraper/);
});

test("npm environment cleanup and Windows executable names are deterministic", () => {
  assert.deepEqual(cleanNpmEnvironment({ npm_TOKEN: "secret", Safe: "ok" }), {
    Safe: "ok",
  });
  assert.equal(npxExecutable("win32"), "npx.cmd");
  assert.equal(npmExecutable("win32"), "npm.cmd");
  assert.equal(npxExecutable("darwin"), "npx");
  assert.equal(npmExecutable("linux"), "npm");
});

test("unsupported agent names are rejected before execution", () => {
  assert.throws(
    () => buildSkillsInstallArgs("unknown-agent"),
    /Unsupported agent harness/,
  );
});
