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
    /--skill mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp/,
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

test("fetch makes one request and preserves the endpoint HTML in its CLI envelope", async (t) => {
  let requestUrl;
  const server = http.createServer((request, response) => {
    requestUrl = new URL(request.url, "http://localhost");
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body><h1>Fetched</h1><p>Page</p></body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "fetch",
      "https://target.example",
      "--token",
      "test",
      "--browser-rendering",
      "--super-mode",
      "--geo-code",
      "ID",
      "--wait-for-selector",
      ".ready",
      "--home-page",
      "--block-resources",
      "--max-retries",
      "2",
      "--token-cap",
      "50",
    ],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.data, "<html><body><h1>Fetched</h1><p>Page</p></body></html>");
  assert.equal(requestUrl.searchParams.get("browserRendering"), "true");
  assert.equal(requestUrl.searchParams.get("super"), "true");
  assert.equal(requestUrl.searchParams.get("geoCode"), "ID");
  assert.equal(requestUrl.searchParams.get("waitForSelector"), ".ready");
  assert.equal(requestUrl.searchParams.get("homePage"), "true");
  assert.equal(requestUrl.searchParams.get("blockResources"), "true");
  assert.equal(requestUrl.searchParams.get("maxRetries"), "2");
  assert.equal(requestUrl.searchParams.get("tokenCap"), "50");
});

test("fetch requires explicit browser rendering for selector waits", async () => {
  const result = await runCli([
    "fetch",
    "https://target.example",
    "--token",
    "test",
    "--wait-for-selector",
    ".ready",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires --browser-rendering/);
});

test("fetch supports every browser-rendering and super-mode combination", async (t) => {
  const requestUrls = [];
  const server = http.createServer((request, response) => {
    requestUrls.push(new URL(request.url, "http://localhost"));
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body>ok</body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const combinations = [
    { browserRendering: false, superMode: false, flags: [] },
    { browserRendering: true, superMode: false, flags: ["--browser-rendering"] },
    { browserRendering: false, superMode: true, flags: ["--super-mode"] },
    {
      browserRendering: true,
      superMode: true,
      flags: ["--browser-rendering", "--super-mode"],
    },
  ];

  for (const combination of combinations) {
    const result = await runCli(
      ["fetch", "https://target.example", "--token", "test", ...combination.flags],
      { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
  }

  assert.deepEqual(
    requestUrls.map((requestUrl) => ({
      browserRendering: requestUrl.searchParams.get("browserRendering"),
      superMode: requestUrl.searchParams.get("super"),
    })),
    combinations.map((combination) => ({
      browserRendering: String(combination.browserRendering),
      superMode: String(combination.superMode),
    })),
  );
});

test("API failures produce JSON and a non-zero exit code", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"message":"failed"}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["fetch", "https://target.example", "--token", "test"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.status_code, 500);
  assert.equal(output.error, "HTTP 500");
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

test("status adds domain analytics with a UTC date range", async (t) => {
  let analyticsUrl;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/api/v1/subscription-accounts") {
      response.end(
        JSON.stringify({ data: { tokenLimit: 100, tokenUsage: 10, user: {} } }),
      );
      return;
    }
    analyticsUrl = new URL(request.url, "http://localhost");
    response.end(
      JSON.stringify({
        data: { countAll: 5, successRate: 80, data: [] },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "status",
      "--domain",
      "https://www.example.com/products",
      "--from",
      "24h",
      "--to",
      "2026-08-10T12:00:00Z",
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(analyticsUrl.pathname, "/api/v1/analytic/statuses");
  assert.equal(analyticsUrl.searchParams.get("domain"), "www.example.com");
  assert.equal(
    analyticsUrl.searchParams.get("startDate"),
    "2026-08-09 12:00:00",
  );
  assert.equal(analyticsUrl.searchParams.get("endDate"), "2026-08-10 12:00:00");
  assert.equal(analyticsUrl.searchParams.get("action"), "");
  assert.equal(analyticsUrl.searchParams.get("apiTokenName"), "");
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.source_endpoints, [
    "/subscription-accounts",
    "/analytic/statuses",
  ]);
  assert.equal(output.data.analytics.countAll, 5);
  assert.equal(output.data.analytics.successRate, 80);
});

test("promptless general scrape is rejected instead of routing to fetch", async () => {
  const result = await runCli([
    "scrape",
    "https://target.example",
    "--token",
    "test",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--prompt is required for general and listing/);
});

test("scrape labels schema prompt guidance and sends it only inside message", async (t) => {
  let requestBody;
  const server = http.createServer(async (request, response) => {
    assert.equal(request.url, "/api/v1/scrapers-ai");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!","data":{"id":"result-1"}}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const schemaPath = path.join("test", "fixtures", "product.schema.json");
  const result = await runCli(
    [
      "scrape",
      "https://target.example",
      "--prompt",
      "Extract the product",
      "--schema-prompt",
      schemaPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(requestBody.agent, "general");
  assert.match(requestBody.message, /Extract the product/);
  assert.match(requestBody.message, /JSON Schema/);
  assert.match(requestBody.message, /does not validate this schema/);
  assert.match(requestBody.message, /\"price\"/);
  assert.equal(requestBody.schema, undefined);
});

test("scrape --output writes only extracted JSON and preserves stdout", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "nested", "castillo-caribe.json");
  const extracted = {
    mls: "402170",
    name: "Castillo Caribe",
    location: { district: "South Sound", island: "Grand Cayman" },
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        message: "Successful operation!",
        data: {
          id: "result-1",
          scraperId: "scraper-1",
          status: "Finished",
          data: extracted,
        },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/castillo-caribe",
      "--prompt",
      "Extract all available listing information",
      "--output",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), extracted);
  assert.match(result.stderr, /Wrote extracted JSON/);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.data.id, "result-1");
  assert.deepEqual(envelope.data.data.data, extracted);
});

test("scrape --output preserves a JSON-encoded extraction as the backend string", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "listing.json");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          status: "Finished",
          data: JSON.stringify({ name: "Encoded listing" }),
        },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listing",
      "--prompt",
      "Extract the listing",
      "-o",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(outputPath, "utf8")),
    JSON.stringify({ name: "Encoded listing" }),
  );
});

test("scrape --output rejects undocumented direct run response shapes", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "listing.json");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "result-1",
        scraperId: "scraper-1",
        status: "Finished",
        data: { name: "Direct listing" },
      }),
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listing",
      "--prompt",
      "Extract the listing",
      "--output",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /documented data\.data run object/);
  assert.equal(fs.existsSync(outputPath), false);
});

test("scrape --output does not create a file without extracted data", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "missing", "listing.json");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      '{"message":"Successful operation!","data":{"id":"result-1","status":"Finished"}}',
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listing",
      "--prompt",
      "Extract the listing",
      "--output",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /no extracted data/);
  assert.equal(fs.existsSync(outputPath), false);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

test("scrape --output does not create a file for an unfinished run", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "listing.json");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      '{"message":"Still running","data":{"id":"result-1","status":"Running","data":{"name":"Partial"}}}',
    );
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listing",
      "--prompt",
      "Extract the listing",
      "--output",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not finished \(status: Running\)/);
  assert.equal(fs.existsSync(outputPath), false);
});

test("scrape --output does not create a file when the API fails", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "listing.json");
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"message":"failed"}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listing",
      "--prompt",
      "Extract the listing",
      "--output",
      outputPath,
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(JSON.parse(result.stdout).status_code, 500);
});

test("scrape --output does not replace the required extraction prompt", async (t) => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-cli-output-"),
  );
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const outputPath = path.join(outputRoot, "listing.json");

  const result = await runCli([
    "scrape",
    "https://target.example/listing",
    "--output",
    outputPath,
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--prompt is required for general and listing/);
  assert.equal(fs.existsSync(outputPath), false);
});

test("listing scrape warns agents while keeping stdout as JSON", async (t) => {
  let requestBody;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!","data":{"id":"listing-1"}}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listings",
      "--agent",
      "listing",
      "--prompt",
      "Extract every listing",
      "--max-pages",
      "2",
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.match(result.stderr, /150\+ seconds/);
  assert.match(result.stderr, /do not submit a duplicate request/);
  assert.match(result.stderr, /max-pages=2/);
  assert.equal(requestBody.agent, "listing");
  assert.equal(requestBody.maxPages, 2);
});

test("listing omits maxPages when the user does not supply it", async (t) => {
  let requestBody;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!","data":{"id":"listing-1"}}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example/listings",
      "--agent",
      "listing",
      "--prompt",
      "Extract every listing",
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(requestBody.maxPages, undefined);
  assert.match(result.stderr, /max-pages=backend default/);
});

test("scrape sends the selected Cheap or Super execution mode", async (t) => {
  let requestBody;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!","data":{"id":"result-1"}}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example",
      "--prompt",
      "Extract the page",
      "--mode",
      "super",
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.equal(requestBody.mode, "Super");
});

test("map rejects prompt instead of silently discarding it", async () => {
  const result = await runCli([
    "scrape",
    "https://target.example",
    "--agent",
    "map",
    "--prompt",
    "Find product URLs",
    "--token",
    "test",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--prompt is not accepted by the map agent/);
});

test("map sends only explicitly supplied map parameters", async (t) => {
  let requestBody;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!","data":{"id":"map-1"}}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    [
      "scrape",
      "https://target.example",
      "--agent",
      "map",
      "--max-depth",
      "2",
      "--token",
      "test",
    ],
    { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
  );

  assert.equal(result.code, 0);
  assert.deepEqual(requestBody, {
    url: "https://target.example",
    agent: "map",
    maxDepth: 2,
  });
});

test("rerun rejects endpoint-specific options instead of silently ignoring them", async () => {
  const bulkResult = await runCli([
    "rerun",
    "https://a.example,https://b.example",
    "--bulk",
    "--type",
    "ai",
    "--id",
    "scraper-1",
    "--max-pages",
    "2",
    "--token",
    "test",
  ]);
  assert.equal(bulkResult.code, 1);
  assert.match(bulkResult.stderr, /--max-pages is not accepted by bulk rerun endpoints/);

  const manualResult = await runCli([
    "rerun",
    "https://a.example",
    "--type",
    "manual",
    "--scraper-id",
    "scraper-1",
    "--max-depth",
    "2",
    "--token",
    "test",
  ]);
  assert.equal(manualResult.code, 1);
  assert.match(manualResult.stderr, /--max-depth is only accepted by single AI reruns/);
});

test("single AI rerun omits backend controls unless explicitly supplied", async (t) => {
  const bodies = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful operation!"}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` };

  const defaultResult = await runCli(
    [
      "rerun",
      "https://target.example",
      "--type",
      "ai",
      "--scraper-id",
      "scraper-1",
      "--token",
      "test",
    ],
    environment,
  );
  const configuredResult = await runCli(
    [
      "rerun",
      "https://target.example",
      "--type",
      "ai",
      "--scraper-id",
      "scraper-1",
      "--proxy-country",
      "ID",
      "--max-retry",
      "4",
      "--timeout",
      "90",
      "--token",
      "test",
    ],
    environment,
  );

  assert.equal(defaultResult.code, 0);
  assert.equal(configuredResult.code, 0);
  assert.deepEqual(bodies[0], {
    scraperId: "scraper-1",
    url: "https://target.example",
  });
  assert.deepEqual(bodies[1], {
    scraperId: "scraper-1",
    url: "https://target.example",
    proxyCountry: "ID",
    maxRetry: 4,
    timeout: 90,
  });
});

test("results sends exact structured filters and result can exclude HTML", async (t) => {
  const urls = [];
  const server = http.createServer((request, response) => {
    urls.push(new URL(request.url, "http://localhost"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"message":"Successful fetch","data":[]}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1` };

  const results = await runCli(
    [
      "results",
      "--scraper-id",
      "scraper-1",
      "--status",
      "finished",
      "--type",
      "Rerun-AI",
      "--url",
      "https://target.example/?page=2",
      "--token",
      "test",
    ],
    environment,
  );
  const result = await runCli(
    ["result", "result-1", "--no-include-html", "--token", "test"],
    environment,
  );

  assert.equal(results.code, 0);
  assert.equal(result.code, 0);
  assert.equal(urls[0].searchParams.get("filters[scraperId]"), "scraper-1");
  assert.equal(urls[0].searchParams.get("filters[status]"), "Finished");
  assert.equal(urls[0].searchParams.get("filters[type]"), "Rerun-AI");
  assert.equal(urls[0].searchParams.get("filters[url]"), "https://target.example/?page=2");
  assert.equal(urls[1].pathname, "/api/v1/results/result-1");
  assert.equal(urls[1].searchParams.get("includeHtml"), "false");
});

test("command help distinguishes API parameters from removed client transformations", async () => {
  const fetchHelp = await runCli(["fetch", "--help"]);
  assert.equal(fetchHelp.code, 0);
  assert.doesNotMatch(fetchHelp.stdout, /--format|--unblock/);
  assert.match(fetchHelp.stdout, /--browser-rendering/);

  const scrapeHelp = await runCli(["scrape", "--help"]);
  assert.equal(scrapeHelp.code, 0);
  assert.match(scrapeHelp.stdout, /--schema-prompt/);
  assert.doesNotMatch(scrapeHelp.stdout, /--format|--unblock/);

  const serpHelp = await runCli(["serp", "--help"]);
  assert.equal(serpHelp.code, 0);
  assert.match(serpHelp.stdout, /--format/);
  assert.match(serpHelp.stdout, /--client-timeout/);
});
