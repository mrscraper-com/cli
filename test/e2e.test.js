import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath =
  process.env.MRSCRAPER_E2E_CLI_PATH ??
  path.join(repositoryRoot, "bin", "mrscraper.js");

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

function runCli(args, environment) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        timeout: 15_000,
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

test("published CLI workflow reaches all six data commands with saved authentication", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const query = Object.fromEntries(url.searchParams);
      requests.push({ method: request.method, url, query });
      assert.equal(request.headers.authorization, "Bearer e2e-api-key");
      assert.equal(request.headers["x-api-token"], "e2e-api-key");
      if (query.html === "true" && query.screenshot === "false") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html>token=public-page-value</html>");
        return;
      }
      if (query.markdown === "true" && query.screenshot === "false") {
        response.writeHead(200, { "content-type": "text/markdown" });
        response.end("# Example");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/api/v1/subscription-accounts") {
        response.end(
          JSON.stringify({
            data: {
              tokenLimit: 1000,
              tokenUsage: 125,
              stripeStatus: "active",
              user: { latestApiToken: "atk_do_not_print", isVerified: true },
            },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          success: true,
          data: { job_id: "brand-1" },
          screenshot: "aW1hZ2U=",
        }),
      );
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
  });
  const port = await listen(server);
  t.after(() => close(server));
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-e2e-"),
  );
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const environment = {
    MRSCRAPER_HOME: path.join(temporaryRoot, ".mrscraper"),
    MRSCRAPER_API_KEY: "",
    MRSCRAPER_API_TOKEN: "",
    MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/scraper`,
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  };
  const login = await runCli(
    ["login", "--api-key", "e2e-api-key"],
    environment,
  );
  assert.equal(login.code, 0);
  const authStatus = await runCli(["auth", "status", "--json"], environment);
  assert.equal(JSON.parse(authStatus.stdout).credential_configured, true);

  const cases = [
    [
      "scrape-html",
      "https://example.com/product",
      "--browser-rendering",
      "--wait-for-selector",
      ".product",
      "--timeout",
      "5",
    ],
    ["scrape-markdown", "https://example.com/product"],
    ["get-screenshot", "https://example.com/product", "--screenshot", "full"],
    [
      "scrape-json",
      "https://example.com/product",
      "--prompt",
      "Extract prices",
    ],
    ["scrape-brand", "https://mrscraper.com/"],
    ["web-search", "iphone 17", "--country", "id", "--num-results", "20"],
  ];
  for (const args of cases) {
    const result = await runCli(args, environment);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status_code, 200);
    if (args[0] === "scrape-html")
      assert.equal(payload.data, "<html>token=public-page-value</html>");
    if (args[0] === "scrape-markdown") assert.equal(payload.data, "# Example");
  }
  assert.equal(requests.length, 6);
  assert.ok(
    requests.every(
      ({ method, url }) => method === "GET" && url.pathname === "/scraper",
    ),
  );
  assert.equal(requests[0].query.waitForSelector, ".product");
  assert.equal(requests[2].query.screenshot, "full");
  assert.equal(requests[4].query.action, "brand-scraping");
  assert.deepEqual(requests[5].query, {
    action: "websearch",
    query: "iphone 17",
    country: "id",
    numResults: "20",
  });

  const statusResult = await runCli(["status", "--json"], environment);
  assert.equal(statusResult.code, 0);
  assert.equal(
    JSON.parse(statusResult.stdout).data.account.token_remaining,
    875,
  );
  assert.doesNotMatch(statusResult.stdout, /atk_do_not_print/);
  const logout = await runCli(["logout"], environment);
  assert.equal(logout.code, 0);
  const loggedOutStatus = await runCli(
    ["auth", "status", "--json"],
    environment,
  );
  assert.equal(JSON.parse(loggedOutStatus.stdout).credential_configured, false);
});
