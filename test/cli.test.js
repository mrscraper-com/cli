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

  const result = await runCli(["init", "--skip-install", "--skip-skills"], {
    HOME: homeDirectory,
    XDG_CONFIG_HOME: homeDirectory,
    MRSCRAPER_API_KEY: "",
    MRSCRAPER_API_TOKEN: "",
  });

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

  const login = await runCli(
    ["login", "--api-key", "test-api-key"],
    environment,
  );
  assert.equal(login.code, 0);
  assert.equal(login.stderr, "");
  assert.match(
    login.stdout,
    new RegExp(
      `${authHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/auth\\.json`,
    ),
  );
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
  assert.match(
    result.stdout,
    /for Cursor, Codex, Grok Build: npx -y skills add/,
  );
  assert.match(
    result.stdout,
    /--agent cursor --agent codex --agent grok --yes/,
  );
  assert.doesNotMatch(result.stdout, /MCP/i);
});

test("setup skills can target one harness without requiring detection", async () => {
  const result = await runCli([
    "setup",
    "skills",
    "--agent",
    "codex",
    "--dry-run",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /Would install the MrScraper skill pack for Codex/,
  );
  assert.match(
    result.stdout,
    /--skill mrscraper mrscraper-fetch mrscraper-serp /,
  );
});

test("setup skills can target Grok without requiring detection", async () => {
  const result = await runCli([
    "setup",
    "skills",
    "--agent",
    "grok",
    "--dry-run",
  ]);

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

test("six data commands send the documented GET contracts", async (t) => {
  const sent = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    const url = new URL(request.url, "http://localhost");
    sent.push({
      method: request.method,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers,
      body,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"success":true}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` };
  const cases = [
    [
      "scrape-html",
      "https://target.example",
      "--browser-rendering",
      "--super",
      "--wait-until",
      "load",
      "--return-cookie",
      "--save-result",
    ],
    [
      "scrape-markdown",
      "https://target.example",
      "--html",
      "--geo-code",
      "ID",
      "--proxy-country",
      "sg",
      "--proxy",
      "http://proxy.example",
      "--block-resources",
      "--wait-for-selector",
      ".ready",
      "--max-retries",
      "0",
      "--timeout",
      "60",
    ],
    [
      "get-screenshot",
      "https://target.example",
      "--screenshot",
      "top",
      "--no-html",
      "--markdown",
    ],
    [
      "scrape-json",
      "https://target.example",
      "--prompt",
      "Extract prices",
      "--html",
      "--screenshot",
    ],
    ["scrape-brand", "https://mrscraper.com/"],
    [
      "web-search",
      "e-menessaptieka.lv linkedin",
      "--country",
      "id",
      "--num-results",
      "20",
    ],
  ];
  for (const args of cases) {
    const result = await runCli([...args, "--token", "test"], environment);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).status_code, 200);
  }
  assert.equal(sent.length, cases.length);
  for (const request of sent) {
    assert.equal(request.method, "GET");
    assert.equal(request.body, "");
    assert.equal(request.headers["x-api-token"], "test");
    assert.equal("token" in request.query, false);
  }
  const [html, markdown, screenshot, json, brand, search] = sent.map(
    (request) => request.query,
  );
  assert.deepEqual(html, {
    url: "https://target.example",
    super: "true",
    waitUntil: "load",
    timeout: "300",
    geoCode: "us",
    proxyCountry: "us",
    saveResult: "true",
    blockResources: "false",
    returnCookie: "true",
    browserRendering: "true",
    html: "true",
    markdown: "false",
    screenshot: "false",
  });
  assert.deepEqual(markdown, {
    url: "https://target.example",
    super: "false",
    waitUntil: "domcontentloaded",
    timeout: "60",
    geoCode: "id",
    proxyCountry: "sg",
    proxy: "http://proxy.example",
    maxRetries: "0",
    saveResult: "false",
    blockResources: "true",
    waitForSelector: ".ready",
    returnCookie: "false",
    browserRendering: "true",
    html: "true",
    markdown: "true",
    screenshot: "false",
  });
  assert.equal(screenshot.screenshot, "top");
  assert.equal(screenshot.browserRendering, "true");
  assert.equal(screenshot.html, "false");
  assert.equal(screenshot.markdown, "true");
  assert.equal(json.prompt, "Extract prices");
  assert.equal(json.agent, "general");
  assert.equal(json.html, "true");
  assert.equal(json.screenshot, "true");
  assert.equal(json.super, "false");
  assert.equal(json.saveResult, "false");
  assert.deepEqual(brand, {
    action: "brand-scraping",
    url: "https://mrscraper.com/",
    bundle: "none",
  });
  assert.deepEqual(search, {
    action: "websearch",
    query: "e-menessaptieka.lv linkedin",
    country: "id",
    numResults: "20",
  });
});

test("invalid values and unsupported options fail without a request", async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.end();
  });
  const port = await listen(server);
  t.after(() => close(server));
  const cases = [
    ["scrape-html", "https://target.example", "--timeout", "301"],
    ["scrape-html", "file:///tmp/test"],
    ["scrape-html", "https://target.example", "--geo-code", "usa"],
    ["scrape-html", "https://target.example", "--token-cap", "1"],
    ["scrape-html", "https://target.example", "--record"],
    ["scrape-markdown", "https://target.example", "--screenshot", "full"],
    ["get-screenshot", "https://target.example", "--screenshot", "invalid"],
    ["get-screenshot", "https://target.example", "--browser-rendering"],
    ["scrape-json", "https://target.example", "--wait-for-selector", ".x"],
    ["scrape-json", "https://target.example", "--block-resources"],
    ["scrape-json", "https://target.example", "--return-cookie"],
    ["scrape-json", "https://target.example", "--prompt", " "],
    ["scrape-brand"],
    ["scrape-brand", "https://mrscraper.com/", "--bundle", "clean"],
    ["scrape-brand", "--job-id", "brand-1"],
    ["web-search", "test", "--num-results", "101"],
    ["web-search", "test", "--country", "invalid"],
    ["web-search", "x".repeat(1001)],
  ];
  for (const args of cases) {
    const result = await runCli([...args, "--token", "test"], {
      MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}`,
    });
    assert.equal(result.code, 1, args.join(" "));
    assert.ok(result.stderr.length > 0);
  }
  assert.equal(requests, 0);
});

test("HTTP and application failures produce JSON and a non-zero exit code", async (t) => {
  const page = ["scrape-html", "https://target.example"];
  const brand = ["scrape-brand", "https://mrscraper.com/"];
  const cases = [
    { args: page, status: 500, body: { message: "failed" } },
    {
      args: page,
      status: 200,
      body: { success: false, error: "Scrape failed" },
    },
    { args: page, status: 200, body: { error: "Upstream failed" } },
    {
      args: brand,
      status: 200,
      body: {
        data: { job_id: "brand-1", status: "failed", error: "Brand failed" },
      },
    },
    // The API answers 422, unbilled, for a settled job without usable brand data.
    {
      args: brand,
      status: 422,
      body: {
        message: "brand job settled",
        data: { job_id: "brand-2", status: "succeeded", error: null },
      },
    },
  ];
  let index = 0;
  const server = http.createServer((_request, response) => {
    const { status, body } = cases[index++];
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  const port = await listen(server);
  t.after(() => close(server));
  for (const { args, status } of cases) {
    const result = await runCli([...args, "--token", "test"], {
      MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}`,
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).status_code, status);
  }
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
