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

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

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
  assert.match(result.stdout, /--skill mrscraper mrscraper-fetch mrscraper-serp /);
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

test("scraper-api sends one POST with the SDK query fields and preserves the page body", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: new URL(request.url, "http://localhost"),
      headers: request.headers,
      body: JSON.parse(await readBody(request)),
    });
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body><h1>Retrieved</h1></body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scraper-api",
      "https://target.example",
      "--token",
      "test",
      "--no-html",
      "--markdown",
      "--super",
      "--geo-code",
      "ID",
      "--proxy-country",
      "SG",
      "--no-use-proxy",
      "--proxy",
      "user:pass@proxy.example:8000",
      "--wait-for-selector",
      ".ready",
      "--home-page",
      "--block-resources",
      "--bypass-proxy",
      "--cookie-jar",
      "domain=example.com",
      "--headers",
      '{"Accept-Language":"en"}',
      "--max-retries",
      "0",
      "--token-cap",
      "0",
      "--timeout",
      "300",
      "--stream",
      "--discard-token-secret",
      "discard-me",
    ],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(
    JSON.parse(result.stdout).data,
    "<html><body><h1>Retrieved</h1></body></html>",
  );
  assert.equal(requests.length, 1);
  const [sent] = requests;
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers["x-discard-token-secret"], "discard-me");
  assert.deepEqual(sent.body, {
    url: "https://target.example",
    maxRetries: 0,
    tokenCap: 0,
  });
  assert.deepEqual(Object.fromEntries(sent.url.searchParams), {
    token: "test",
    timeout: "300",
    geoCode: "ID",
    proxyCountry: "SG",
    super: "true",
    useProxy: "false",
    proxy: "user:pass@proxy.example:8000",
    html: "false",
    markdown: "true",
    waitForSelector: ".ready",
    warmStart: "true",
    blockResources: "true",
    bypassProxy: "true",
    cookieJar: "domain=example.com",
    headers: '{"Accept-Language":"en"}',
    stream: "true",
  });
});

test("scraper-api leaves browser rendering automatic unless set, and screenshots force it", async (t) => {
  const sent = [];
  const server = http.createServer(async (request, response) => {
    await readBody(request);
    const params = new URL(request.url, "http://localhost").searchParams;
    sent.push({
      browserRendering: params.get("browserRendering"),
      screenshot: params.get("screenshot"),
    });
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body>ok</body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const cases = [
    { flags: [], browserRendering: null, screenshot: null },
    { flags: ["--browser-rendering"], browserRendering: "true", screenshot: null },
    { flags: ["--no-browser-rendering"], browserRendering: "false", screenshot: null },
    {
      flags: ["--screenshot", "--no-browser-rendering"],
      browserRendering: "true",
      screenshot: "true",
    },
  ];
  for (const { flags } of cases) {
    const result = await runCli(
      ["scraper-api", "https://target.example", "--token", "test", ...flags],
      { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.code, 0);
  }

  assert.deepEqual(
    sent,
    cases.map(({ browserRendering, screenshot }) => ({ browserRendering, screenshot })),
  );
});

test("scraper-api rejects a timeout above 300 seconds before sending a request", async (t) => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.end();
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["scraper-api", "https://target.example", "--token", "test", "--timeout", "301"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /timeout must be an integer from 1 to 300/);
  assert.equal(requestCount, 0);
});

test("API failures produce JSON and a non-zero exit code", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"message":"failed"}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["scraper-api", "https://target.example", "--token", "test"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.status_code, 500);
  assert.equal(output.error, "HTTP 500");
});

test("web-search asks for parsed JSON and lets explicit options override a Google URL", async (t) => {
  const bodies = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/google/serp/v2/sync");
    bodies.push(JSON.parse(await readBody(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"success":true,"data":{"organic":[]}}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}` };
  const googleUrl = "https://www.google.com/search?q=web+scraping&gl=us&hl=en&start=20";

  const derived = await runCli(["web-search", googleUrl, "--token", "test"], environment);
  const overridden = await runCli(
    ["web-search", googleUrl, "--token", "test", "--region", "id", "--format", "html"],
    environment,
  );

  assert.equal(derived.code, 0);
  assert.equal(overridden.code, 0);
  assert.deepEqual(bodies, [
    {
      query: "web scraping",
      region: "us",
      language: "en",
      page: 3,
      format: "json",
      renderJs: false,
    },
    {
      query: "web scraping",
      region: "id",
      language: "en",
      page: 3,
      format: "html",
      renderJs: false,
    },
  ]);
});

test("status summarizes the account without exposing API tokens", async (t) => {
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

  const result = await runCli(["status", "--token", "test"], {
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  });

  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, "mrscraper-cli-status-summary");
  assert.deepEqual(output.source_endpoints, ["/subscription-accounts"]);
  assert.equal(output.data.account.token_remaining, 80);
  assert.equal(output.data.account.subscription_status, "active");
  assert.doesNotMatch(result.stdout, /atk_secret|sub_secret/);
});

test("status --pretty renders a human dashboard instead of bare JSON", async (t) => {
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
    ["status", "--pretty", "--no-color", "--token", "test"],
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

test("status reports an API failure as JSON with a non-zero exit code", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"message":"Unauthenticated."}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(["status", "--json", "--token", "bad"], {
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  });

  assert.equal(result.code, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status_code, 401);
  assert.match(output.error, /Unauthorized/);
  assert.equal(output.kind, undefined);
});
