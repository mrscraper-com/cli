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
    /--skill mrscraper mrscraper-scrape-html mrscraper-scrape-markdown mrscraper-get-screenshot mrscraper-scrape-brand mrscraper-scrape-json mrscraper-web-search /,
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
    ["scrape-html", "https://target.example"],
    [
      "scrape-html",
      "https://target.example",
      "--no-browser-rendering",
      "--screenshot",
      "top",
    ],
    [
      "scrape-html",
      "https://target.example",
      "--browser-rendering",
      "--warm-start",
      "--action",
      "analytics",
      "--max-age",
      "3600000",
      "--screenshot",
      "1280x800-75",
    ],
    [
      "scrape-markdown",
      "https://target.example",
      "--no-browser-rendering",
      "--warm-start",
      "--geo-code",
      "ID",
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
      "--wait-for-selector",
      "body",
      "--geo-code",
      "gb",
      "--timeout",
      "330",
    ],
    [
      "scrape-json",
      "https://target.example",
      "--prompt",
      "Extract prices",
      "--no-html",
      "--screenshot",
      "--warm-start",
      "--block-resources",
      "--wait-for-selector",
      ".x",
    ],
    ["scrape-brand", "https://mrscraper.com/"],
    ["web-search", "mrscraper"],
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
  const [
    htmlDefaults,
    htmlScreenshot,
    html,
    markdown,
    screenshot,
    json,
    brand,
    searchDefaults,
    search,
  ] = sent.map((request) => request.query);
  assert.deepEqual(htmlDefaults, {
    url: "https://target.example",
    html: "true",
    markdown: "false",
    timeout: "300",
    warmStart: "false",
    blockResources: "false",
    saveResult: "true",
    maxAge: "0",
    screenshot: "false",
  });
  assert.deepEqual(htmlScreenshot, {
    url: "https://target.example",
    html: "true",
    markdown: "false",
    browserRendering: "true",
    timeout: "300",
    warmStart: "false",
    blockResources: "false",
    saveResult: "true",
    maxAge: "0",
    screenshot: "top",
  });
  assert.deepEqual(html, {
    url: "https://target.example",
    html: "true",
    markdown: "false",
    browserRendering: "true",
    timeout: "300",
    warmStart: "true",
    blockResources: "false",
    action: "analytics",
    saveResult: "true",
    maxAge: "3600000",
    screenshot: "1280x800-75",
  });
  assert.deepEqual(markdown, {
    url: "https://target.example",
    markdown: "true",
    html: "false",
    screenshot: "false",
    browserRendering: "false",
    timeout: "60",
    warmStart: "true",
    blockResources: "true",
    waitForSelector: ".ready",
    geoCode: "id",
    saveResult: "true",
    maxAge: "0",
    maxRetries: "0",
  });
  assert.deepEqual(screenshot, {
    url: "https://target.example",
    screenshot: "full",
    html: "false",
    markdown: "false",
    browserRendering: "true",
    timeout: "330",
    waitForSelector: "body",
    geoCode: "gb",
    saveResult: "true",
    maxAge: "0",
  });
  assert.deepEqual(json, {
    url: "https://target.example",
    prompt: "Extract prices",
    agent: "general",
    html: "false",
    timeout: "300",
    warmStart: "true",
    blockResources: "true",
    waitForSelector: ".x",
    saveResult: "true",
    maxAge: "0",
    screenshot: "true",
  });
  assert.deepEqual(brand, {
    action: "brand-scraping",
    url: "https://mrscraper.com/",
    bundle: "none",
  });
  assert.deepEqual(searchDefaults, {
    action: "websearch",
    query: "mrscraper",
    numResults: "10",
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
  const page = "https://target.example";
  const cases = [
    ["scrape-html", page, "--timeout", "331"],
    ["scrape-html", "file:///tmp/test"],
    ["scrape-html", page, "--geo-code", "usa"],
    // Results are always saved and tokenCap is never sent, so neither is an option.
    ["scrape-html", page, "--token-cap", "30"],
    ["scrape-html", page, "--save-result"],
    ["scrape-html", page, "--no-save-result"],
    ["get-screenshot", page, "--no-save-result"],
    ["scrape-json", page, "--token-cap", "30"],
    ["scrape-html", page, "--max-age", "604800001"],
    ["scrape-html", page, "--max-age", "-1"],
    ["scrape-html", page, "--screenshot", "true"],
    ["scrape-html", page, "--screenshot", "99x800"],
    ["scrape-html", page, "--wait-for-selector", "a".repeat(501)],
    ["scrape-html", page, "--record"],
    // Removed: these fields are not in the Scraper API reference.
    ["scrape-html", page, "--super"],
    ["scrape-html", page, "--wait-until", "load"],
    ["scrape-html", page, "--proxy-country", "sg"],
    ["scrape-html", page, "--proxy", "http://proxy.example"],
    ["scrape-html", page, "--return-cookie"],
    ["scrape-markdown", page, "--html"],
    ["scrape-markdown", page, "--screenshot", "full"],
    ["get-screenshot", page, "--screenshot", "top"],
    ["get-screenshot", page, "--browser-rendering"],
    ["get-screenshot", page, "--no-html"],
    ["get-screenshot", page, "--markdown"],
    ["get-screenshot", page, "--block-resources"],
    ["get-screenshot", page, "--action", "analytics"],
    ["scrape-json", page, "--action", "analytics"],
    ["scrape-json", page, "--return-cookie"],
    ["scrape-json", page, "--prompt", " "],
    ["scrape-brand"],
    ["scrape-brand", "https://mrscraper.com/", "--bundle", "clean"],
    ["scrape-brand", "https://mrscraper.com/", "--max-age", "0"],
    // Scrape Brand takes only the URL.
    ["scrape-brand", "https://mrscraper.com/", "--timeout", "120"],
    ["scrape-brand", "https://mrscraper.com/", "--warm-start"],
    ["scrape-brand", "https://mrscraper.com/", "--geo-code", "gb"],
    ["scrape-brand", "https://mrscraper.com/", "--browser-rendering"],
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

test("status returns the raw account API response", async (t) => {
  const accountResponse = {
    message: "Successful operation!",
    data: {
      tokenLimit: "100",
      tokenUsage: "20",
      stripeStatus: "active",
      stripeSubscriptionId: "sub_example",
      rateLimit: 10,
      rateTtl: 60,
      isAutoRenew: true,
      customField: { enabled: false, value: null },
      user: {
        name: "Ada",
        email: "ada@example.com",
        latestApiToken: "atk_example",
        isVerified: true,
      },
    },
  };
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/api/v1/subscription-accounts");
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "status-1",
    });
    response.end(JSON.stringify(accountResponse));
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(["status", "--token", "test"], {
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  });

  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output).sort(), [
    "data",
    "headers",
    "status_code",
  ]);
  assert.equal(output.status_code, 200);
  assert.deepEqual(output.data, accountResponse);
  assert.equal(output.headers["content-type"], "application/json");
  assert.equal(output.headers["x-request-id"], "status-1");
});

test("status --json preserves an account list without creating a summary", async (t) => {
  const accountResponse = {
    data: [
      { tokenLimit: 1000, tokenUsage: 250, stripeStatus: "active" },
      { tokenLimit: null, tokenUsage: 0, stripeStatus: "trialing" },
    ],
    meta: { total: 2 },
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(accountResponse));
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(["status", "--json", "--token", "test"], {
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout).data, accountResponse);
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
  assert.deepEqual(output.data, { message: "Unauthenticated." });
  assert.equal(output.kind, undefined);
});

test("warm-start is accepted by HTML, Markdown, and JSON, not screenshots", async () => {
  const result = await runCli([
    "get-screenshot",
    "https://example.com",
    "--warm-start",
    "--token",
    "test",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option.*warm-start/);
});
