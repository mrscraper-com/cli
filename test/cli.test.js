import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
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

test("fetch prints only JSON to stdout and converts HTML to Markdown", async (t) => {
  let requestUrl;
  const server = http.createServer((request, response) => {
    requestUrl = new URL(request.url, "http://localhost");
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body><h1>Fetched</h1><p>Page</p></body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["fetch", "https://target.example", "--token", "test", "--unblock", "never"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.format, "markdown");
  assert.match(output.data, /# Fetched/);
  assert.equal(requestUrl.searchParams.get("browserRendering"), "false");
});

test("API failures produce JSON and a non-zero exit code", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"message":"failed"}');
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["fetch", "https://target.example", "--token", "test", "--unblock", "never"],
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
  assert.equal(output.data.account.token_remaining, 80);
  assert.equal(output.data.account.subscription_status, "active");
  assert.doesNotMatch(result.stdout, /atk_secret|sub_secret/);
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
  assert.equal(output.data.analytics.countAll, 5);
  assert.equal(output.data.analytics.successRate, 80);
});

test("promptless scrape remains an HTML-compatible fetch alias", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body>Legacy fetch</body></html>");
  });
  const port = await listen(server);
  t.after(() => close(server));

  const result = await runCli(
    ["scrape", "https://target.example", "--token", "test", "--unblock", "never"],
    { MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}` },
  );

  assert.equal(result.code, 0);
  assert.match(result.stderr, /deprecated/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.format, "html");
  assert.match(output.data, /Legacy fetch/);
});

test("scrape includes a local JSON Schema in the AI extraction message", async (t) => {
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
      "--schema",
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
  assert.match(requestBody.message, /\"price\"/);
});
