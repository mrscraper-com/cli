import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(repositoryRoot, "bin", "mrscraper.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runCli(args, environment = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        timeout: 10_000,
      },
      (error, stdout, stderr) => {
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

test("removed data commands fail instead of calling obsolete APIs", async () => {
  for (const command of ["fetch", "serp", "status", "scrape", "rerun", "result", "results", "scraper-api", "Account"]) {
    const result = await runCli([command]);
    assert.equal(result.code, 1, command);
    assert.match(result.stderr, /unknown command|too many arguments/, command);
  }
});

test("account reports HTTP and invalid response failures with a non-zero exit code", async (t) => {
  let status = 401;
  let body = '{"message":"failed"}';
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  const port = await listen(server);
  t.after(() => close(server));
  for (status of [401, 403, 500, 200]) {
    if (status === 200) body = '{"data":null}';
    const result = await runCli(["account", "--json", "--token", "test"], {
      MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).status_code, status);
    assert.ok(JSON.parse(result.stdout).error);
  }
});

test("init never starts authentication when stdin is non-interactive", async (t) => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-home-"),
  );
  t.after(() => fs.rmSync(homeDirectory, { recursive: true, force: true }));

  const result = await runCli(
    ["init", "--skip-install", "--skip-skills"],
    {
      HOME: homeDirectory,
      XDG_CONFIG_HOME: homeDirectory,
      MRSCRAPER_API_KEY: "",
      MRSCRAPER_API_TOKEN: "",
    },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Authentication not configured/);
  assert.match(result.stdout, /run `mrscraper login` explicitly/);
  assert.doesNotMatch(result.stdout, /MrScraper API key:/);
});

test("login --api-key and auth status use ~/.mrscraper/auth.json", async (t) => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-auth-"),
  );
  t.after(() => fs.rmSync(homeDirectory, { recursive: true, force: true }));
  const authHome = path.join(homeDirectory, ".mrscraper");
  const environment = {
    MRSCRAPER_HOME: authHome,
    MRSCRAPER_API_KEY: "",
    MRSCRAPER_API_TOKEN: "",
  };

  const login = await runCli(["login", "--api-key", "test-api-key"], environment);
  assert.equal(login.code, 0);
  assert.equal(login.stderr, "");
  assert.match(login.stdout, new RegExp(`${authHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/auth\\.json`));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(authHome, "auth.json"), "utf8")),
    {
      version: 1,
      auth_type: "api_key",
      api_key: "test-api-key",
    },
  );

  const status = await runCli(["auth", "status", "--json"], environment);
  assert.equal(status.code, 0);
  assert.equal(status.stderr, "");
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.credential_configured, true);
  assert.equal(payload.auth_type, "api_key");
  assert.doesNotMatch(status.stdout, /test-api-key/);
});

test("login --no-browser never waits for secret input without a terminal", async (t) => {
  const authHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-no-browser-"),
  );
  t.after(() => fs.rmSync(authHome, { recursive: true, force: true }));

  const result = await runCli(["login", "--no-browser"], {
    MRSCRAPER_HOME: authHome,
    MRSCRAPER_API_KEY: "",
    MRSCRAPER_API_TOKEN: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires a terminal/);
  assert.doesNotMatch(result.stdout, /MrScraper API key:/);
  assert.equal(fs.existsSync(path.join(authHome, "auth.json")), false);
});

test("init dry-run detects installed harnesses without changing the system", async (t) => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-home-"),
  );
  t.after(() => fs.rmSync(homeDirectory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(homeDirectory, ".cursor"));
  fs.mkdirSync(path.join(homeDirectory, ".codex"));
  fs.mkdirSync(path.join(homeDirectory, ".grok"));

  const result = await runCli(
    ["init", "--skip-install", "--skip-auth", "--all", "--dry-run"],
    { HOME: homeDirectory },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Skipping global CLI installation/);
  assert.match(result.stdout, /for Cursor, Codex, Grok Build: npx -y skills add/);
  assert.match(result.stdout, /--agent cursor --agent codex --agent grok --yes/);
  assert.doesNotMatch(result.stdout, /MCP/i);
});

test("setup skills can target one harness without requiring detection", async () => {
  const result = await runCli(["setup", "skills", "--agent", "codex", "--dry-run"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Would install the MrScraper skill pack for Codex/);
  assert.match(
    result.stdout,
    /--skill mrscraper mrscraper-scraper-api mrscraper-account mrscraper-web-search/,
  );
});

test("setup skills can target Grok without requiring detection", async () => {
  const result = await runCli(["setup", "skills", "--agent", "grok", "--dry-run"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /for Grok Build/);
  assert.match(result.stdout, /--agent grok --yes/);
});

test("setup skills can target Hermes without requiring detection", async () => {
  const result = await runCli([
    "setup",
    "skills",
    "--agent",
    "hermes",
    "--dry-run",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /for Hermes Agent/);
  assert.match(result.stdout, /--agent hermes-agent --yes/);
});

test("API failures produce JSON and a non-zero exit code", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"message":"failed"}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["scraperAPI", "https://target.example", "--token", "test"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.status_code, 500);
  assert.equal(output.error, "HTTP 500");
});

test("account summarizes the account without exposing API tokens", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/api/v1/subscription-accounts");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        message: "Successful operation!",
        data: {
          tokenLimit: 100,
          tokenUsage: 20,
          stripeStatus: "active",
          stripeSubscriptionId: "sub_secret",
          rateLimit: 10,
          rateTtl: 60,
          isAutoRenew: true,
          user: {
            name: "Ada",
            email: "ada@example.com",
            latestApiToken: "atk_secret",
            isVerified: true,
          },
        },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  for (const command of ["account"]) {
    const result = await runCli([command, "--token", "test"], {
      MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    });

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.data.account.token_remaining, 80);
    assert.equal(output.data.account.subscription_status, "active");
    assert.doesNotMatch(result.stdout, /atk_secret|sub_secret/);
  }
});

test("scraperAPI command sends SDK options through a POST request", async (t) => {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      method: request.method, url: new URL(request.url, "http://localhost"),
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"html":"<html>page</html>","markdown":"page"}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` };
  const result = await runCli([
    "scraperAPI", "https://target.example", "--token", "test", "--no-html",
    "--markdown", "--screenshot", "--no-browser-rendering", "--super", "--home-page",
    "--no-use-proxy", "--headers", '{"x-target":"yes"}', "--token-cap", "0", "--no-stream",
  ], environment);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.markdown, "page");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { url: "https://target.example", maxRetries: 3, tokenCap: 0 });
  const params = calls[0].url.searchParams;
  for (const [key, value] of Object.entries({
    html: "false", markdown: "true", browserRendering: "true", screenshot: "true",
    super: "true", warmStart: "true", useProxy: "false", stream: "false", headers: '{"x-target":"yes"}',
  })) assert.equal(params.get(key), value, key);
  const defaults = await runCli(["scraperAPI", "https://target.example", "--token", "test"], environment);
  assert.equal(defaults.code, 0, defaults.stderr);
  assert.equal(calls[1].url.searchParams.has("browserRendering"), false);
  assert.equal(calls[1].url.searchParams.has("stream"), false);
});

test("webSearch command accepts query text and Google URLs", async (t) => {
  const bodies = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(request.url, "/api/google/serp/v2/sync");
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"results":[]}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  for (const input of ["python scraping", "https://google.com/search?q=python+scraping&gl=id&start=10"]) {
    const result = await runCli(["webSearch", input, "--token", "test"], {
      MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}`,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).data, { results: [] });
  }
  assert.deepEqual(bodies, [
    { query: "python scraping", format: "json", renderJs: false },
    { query: "python scraping", format: "json", renderJs: false, region: "id", page: 2 },
  ]);
});

test("account --pretty renders a human dashboard instead of bare JSON", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          tokenLimit: 1000,
          tokenUsage: 250,
          stripeStatus: "active",
          rateLimit: 30,
          rateTtl: 60,
          isAutoRenew: true,
          user: {
            name: "Ada",
            email: "ada@example.com",
            isVerified: true,
          },
        },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["account", "--pretty", "--no-color", "--token", "test"],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /MrScraper  ACCOUNT & USAGE/);
  assert.match(result.stdout, /● ACTIVE/);
  assert.match(result.stdout, /250 used\s+·\s+750 remaining/);
  assert.match(result.stdout, /Tip: pass --json/);
  assert.doesNotMatch(result.stdout, /^\s*\{/);
  assert.doesNotMatch(result.stdout, /\x1b\[/);
});
