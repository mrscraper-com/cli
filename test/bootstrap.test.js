import test from "node:test";
import assert from "node:assert/strict";
import { installGlobalCli, runBootstrap } from "../lib/bootstrap.js";

test("installGlobalCli installs the exact running package version safely", () => {
  let call;
  const result = installGlobalCli({
    version: "9.8.7",
    environment: {
      PATH: "/test/bin",
      npm_config_user_agent: "outer npx",
      INIT_CWD: "/outer/project",
    },
    execute: (command, args, options) => {
      call = { command, args, options };
    },
    log: () => {},
  });

  assert.deepEqual(result, {
    command: "npm",
    args: ["install", "--global", "@mrscraper/cli@9.8.7"],
  });
  assert.equal(call.command, "npm");
  assert.deepEqual(call.args, result.args);
  assert.equal(call.options.stdio, "inherit");
  assert.equal(call.options.env.PATH, "/test/bin");
  assert.equal(call.options.env.npm_config_user_agent, undefined);
  assert.equal(call.options.env.INIT_CWD, undefined);
});

test("installGlobalCli accepts a sandbox package spec override", () => {
  let call;

  installGlobalCli({
    environment: {
      MRSCRAPER_CLI_PACKAGE_SPEC: "/tmp/mrscraper-cli.tgz",
    },
    execute: (command, args) => {
      call = { command, args };
    },
    log: () => {},
  });

  assert.deepEqual(call, {
    command: "npm",
    args: ["install", "--global", "/tmp/mrscraper-cli.tgz"],
  });
});

test("runBootstrap executes install, authentication, and skill phases", async () => {
  const calls = [];
  const messages = [];

  const result = await runBootstrap(
    { agent: "codex", apiKey: "secret-key" },
    {
      installCli: (options) => calls.push(["cli", options.dryRun]),
      hasCredentials: () => true,
      authenticate: (apiKey) => calls.push(["auth", apiKey]),
      installSkill: (options) => calls.push(["skill", options.agent]),
      log: (message) => messages.push(message),
      logError: (message) => messages.push(message),
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ["cli", undefined],
    ["auth", "secret-key"],
    ["skill", "codex"],
  ]);
  assert.doesNotMatch(messages.join("\n"), /secret-key/);
  assert.match(messages.join("\n"), /setup is complete/);
});

test("runBootstrap reuses existing credentials and --yes never prompts", async () => {
  let authenticated = false;
  const messages = [];

  await runBootstrap(
    { yes: true, skipInstall: true, skipSkills: true },
    {
      hasCredentials: () => true,
      authenticate: () => {
        authenticated = true;
      },
      log: (message) => messages.push(message),
      logError: (message) => messages.push(message),
    },
  );

  assert.equal(authenticated, false);
  assert.match(messages.join("\n"), /credentials are already configured/);
});

test("runBootstrap leaves missing authentication for later in non-interactive mode", async () => {
  let authenticated = false;
  const messages = [];

  await runBootstrap(
    { nonInteractive: true, skipInstall: true, skipSkills: true },
    {
      hasCredentials: () => false,
      authenticate: () => {
        authenticated = true;
      },
      log: (message) => messages.push(message),
      logError: (message) => messages.push(message),
    },
  );

  assert.equal(authenticated, false);
  assert.match(messages.join("\n"), /Authentication not configured/);
  assert.match(messages.join("\n"), /MRSCRAPER_API_KEY/);
  assert.match(messages.join("\n"), /run `mrscraper login` explicitly/);
});

test("runBootstrap leaves missing authentication for later with --yes", async () => {
  let authenticated = false;

  await runBootstrap(
    { yes: true, skipInstall: true, skipSkills: true },
    {
      hasCredentials: () => false,
      authenticate: () => {
        authenticated = true;
      },
      log: () => {},
      logError: () => {},
    },
  );

  assert.equal(authenticated, false);
});

test("runBootstrap asks for authentication only in interactive mode", async () => {
  let authenticated = false;

  await runBootstrap(
    { skipInstall: true, skipSkills: true },
    {
      hasCredentials: () => false,
      authenticate: () => {
        authenticated = true;
      },
      log: () => {},
      logError: () => {},
    },
  );

  assert.equal(authenticated, true);
});

test("runBootstrap dry-run makes no changes and reports every phase", async () => {
  let executed = false;
  const messages = [];

  await runBootstrap(
    { dryRun: true, apiKey: "secret-key", agent: "codex" },
    {
      installCli: ({ dryRun }) => {
        assert.equal(dryRun, true);
      },
      hasCredentials: () => false,
      authenticate: () => {
        executed = true;
      },
      installSkill: ({ dryRun }) => {
        assert.equal(dryRun, true);
      },
      log: (message) => messages.push(message),
      logError: (message) => messages.push(message),
    },
  );

  assert.equal(executed, false);
  assert.match(messages.join("\n"), /Would save the supplied/);
  assert.doesNotMatch(messages.join("\n"), /secret-key/);
});

test("runBootstrap attempts later phases and fails overall when one phase fails", async () => {
  let skillAttempted = false;
  const errors = [];

  await assert.rejects(
    runBootstrap(
      { skipAuth: true },
      {
        installCli: () => {
          throw new Error("permission denied");
        },
        installSkill: () => {
          skillAttempted = true;
        },
        log: () => {},
        logError: (message) => errors.push(message),
      },
    ),
    /Bootstrap completed with 1 error/,
  );

  assert.equal(skillAttempted, true);
  assert.match(errors.join("\n"), /Global CLI installation failed: permission denied/);
});
