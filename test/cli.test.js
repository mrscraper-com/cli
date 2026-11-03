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
  for (const command of [
    "fetch", "status", "scrape", "rerun", "result", "results", "scraper-api", "Account",
    "scraperHtml", "scraper_html", "scraperMarkdown", "scraper_markdown", "getScreenshot", "get_screenshot",
    "scraperJson", "scraper_json", "scraperMultiplePage", "scraper_multiple_page", "scraperSitemap",
    "scraper_sitemap", "scrapeBrand", "scrape_brand", "getBrand", "get_brand",
  ]) {
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

test("scraperAPI sends a GET with outputs and shared options in the query string", async (t) => {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({ method: request.method, url: new URL(request.url, "http://localhost"), body: Buffer.concat(chunks).toString("utf8"), headers: request.headers });
    const params = calls.at(-1).url.searchParams;
    if (params.get("markdown") === "true" || params.get("screenshot") === "true") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"html":"<p>page</p>","markdown":"page","screenshot":"iVBORw0KGgo="}');
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>page</html>");
    }
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` };

  const htmlOnly = await runCli(["scraperAPI", "https://target.example", "--token", "test"], environment);
  assert.equal(htmlOnly.code, 0, htmlOnly.stderr);
  assert.equal(JSON.parse(htmlOnly.stdout).data, "<html>page</html>");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, "");
  assert.equal(calls[0].headers["x-api-token"], "test");
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    token: "test", timeout: "120", geoCode: "US", html: "true", markdown: "false",
    url: "https://target.example", maxRetries: "3",
  });

  const combined = await runCli([
    "scraperAPI", "https://target.example", "--token", "test", "--markdown", "--screenshot",
    "--no-browser-rendering", "--super", "--home-page", "--no-use-proxy", "--headers", '{"x-target":"yes"}',
    "--token-cap", "0", "--max-retries", "5", "--no-stream", "--wait-until", "networkidle", "--timeout", "60",
    "--discard-token-secret", "discard",
  ], environment);
  assert.equal(combined.code, 0, combined.stderr);
  assert.deepEqual(JSON.parse(combined.stdout).data, { html: "<p>page</p>", markdown: "page", screenshot: "iVBORw0KGgo=" });
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].headers["x-discard-token-secret"], "discard");
  for (const [key, value] of Object.entries({
    html: "true", markdown: "true", screenshot: "true", browserRendering: "true", super: "true", warmStart: "true",
    useProxy: "false", stream: "false", waitUntil: "networkidle", headers: '{"x-target":"yes"}',
    tokenCap: "0", maxRetries: "5", timeout: "60", url: "https://target.example",
  })) assert.equal(calls[1].url.searchParams.get(key), value, key);

  const markdownOnly = await runCli(["scraperAPI", "https://target.example", "--token", "test", "--no-html", "--markdown"], environment);
  assert.equal(markdownOnly.code, 0, markdownOnly.stderr);
  assert.equal(calls[2].url.searchParams.get("html"), "false");
  assert.equal(calls[2].url.searchParams.has("screenshot"), false);
  assert.equal(calls[2].url.searchParams.has("browserRendering"), false);
});

test("scraperAPI rejects requests without an output before contacting the API", async () => {
  const result = await runCli(["scraperAPI", "https://target.example", "--token", "test", "--no-html"], {
    MRSCRAPER_FETCH_BASE_URL: "http://127.0.0.1:9",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /at least one output/i);
  const timeout = await runCli(["scraperAPI", "https://target.example", "--token", "test", "--timeout", "301"]);
  assert.equal(timeout.code, 1);
  assert.match(timeout.stderr, /timeout must be an integer from 1 to 300/);
});

test("scraperAPI --save writes HTML unchanged", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-download-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html>saved</html>");
  });
  const port = await listen(server);
  t.after(() => close(server));
  const destination = path.join(directory, "page.html");
  const result = await runCli(["scraperAPI", "https://target.example", "--save", destination, "--token", "test"], { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readFileSync(destination, "utf8"), "<html>saved</html>");
  assert.equal(JSON.parse(result.stdout).saved_to, destination);
});

test("webSearch command posts the websearch action with country and result count", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"success":true,"message":"Search completed","data":[{"rank":1,"title":"Example","url":"https://example.com","description":"d","source":"s"}]}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` };
  const result = await runCli(["webSearch", "e-menessaptieka.lv linkedin", "--country", "us", "--num-results", "25", "--token", "test"], environment);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.data[0].rank, 1);
  const defaults = await runCli(["webSearch", "python scraping", "--token", "test"], environment);
  assert.equal(defaults.code, 0, defaults.stderr);
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [["POST", "/"], ["POST", "/"]]);
  assert.equal(requests[0].headers["x-api-token"], "test");
  assert.match(requests[0].headers["content-type"], /^application\/json/);
  assert.deepEqual(requests.map(({ body }) => body), [
    { action: "websearch", query: "e-menessaptieka.lv linkedin", country: "us", numResults: 25 },
    { action: "websearch", query: "python scraping", numResults: 10 },
  ]);
});

test("webSearch rejects out-of-range result counts and removed flags", async () => {
  for (const value of ["9", "101", "abc"]) {
    const result = await runCli(["webSearch", "books", "--num-results", value, "--token", "test"]);
    assert.equal(result.code, 1, value);
    assert.match(result.stderr, /num results must be an integer from 10 to 100/, value);
  }
  for (const flag of ["--region", "--language", "--page", "--format", "--raw", "--render-js", "--client-timeout"]) {
    const result = await runCli(["webSearch", "books", flag, "x", "--token", "test"]);
    assert.equal(result.code, 1, flag);
    assert.match(result.stderr, /unknown option/, flag);
  }
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
