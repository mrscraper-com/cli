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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : null;
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

test("published CLI workflow reaches every data command with truthful wire contracts", async (t) => {
  const requests = [];

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const body = request.method === "POST" ? await readJsonBody(request) : null;
      requests.push({ method: request.method, url, body, headers: request.headers });

      assert.equal(request.headers.authorization, "Bearer e2e-api-key");
      assert.equal(request.headers["x-api-token"], "e2e-api-key");

      if (url.pathname === "/scraper") {
        response.writeHead(200, { "content-type": "text/html", "x-request-id": "page-1" });
        response.end("<html><body>token=public-page-value</body></html>");
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/sync/api/google/serp/v2/sync") {
        response.end(JSON.stringify({ success: true, html: "<html>results</html>" }));
        return;
      }
      if (url.pathname === "/api/v1/subscription-accounts") {
        response.end(
          JSON.stringify({
            data: {
              tokenLimit: 1000,
              tokenUsage: 125,
              stripeStatus: "active",
              rateLimit: 30,
              rateTtl: 60,
              user: {
                name: "E2E User",
                email: "e2e@example.com",
                latestApiToken: "atk_do_not_print",
                isVerified: true,
              },
            },
          }),
        );
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"message":"not found"}');
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
  });
  const port = await listen(server);
  t.after(() => close(server));

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-e2e-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const environment = {
    MRSCRAPER_HOME: path.join(temporaryRoot, ".mrscraper"),
    MRSCRAPER_API_KEY: "",
    MRSCRAPER_API_TOKEN: "",
    MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/scraper`,
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}/sync`,
  };

  const login = await runCli(["login", "--api-key", "e2e-api-key"], environment);
  assert.equal(login.code, 0);
  const authStatus = await runCli(["auth", "status", "--json"], environment);
  assert.equal(JSON.parse(authStatus.stdout).credential_configured, true);

  const pageResult = await runCli(
    [
      "scraper-api",
      "https://example.com/product",
      "--browser-rendering",
      "--geo-code",
      "ID",
      "--wait-for-selector",
      ".product",
      "--home-page",
      "--block-resources",
      "--max-retries",
      "2",
      "--token-cap",
      "75",
      "--timeout",
      "5",
    ],
    environment,
  );
  assert.equal(pageResult.code, 0);
  assert.equal(
    JSON.parse(pageResult.stdout).data,
    "<html><body>token=public-page-value</body></html>",
  );

  const searchResult = await runCli(
    [
      "web-search",
      "iphone 17",
      "--region",
      "id",
      "--language",
      "id",
      "--page",
      "2",
      "--format",
      "html",
      "--render-js",
      "--timeout",
      "5",
    ],
    environment,
  );
  assert.equal(searchResult.code, 0);

  const statusResult = await runCli(["status", "--json"], environment);
  assert.equal(statusResult.code, 0);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.kind, "mrscraper-cli-status-summary");
  assert.equal(status.data.account.token_remaining, 875);
  assert.doesNotMatch(statusResult.stdout, /atk_do_not_print/);

  const pageRequests = requests.filter(({ url }) => url.pathname === "/scraper");
  assert.equal(pageRequests.length, 1);
  const [pageRequest] = pageRequests;
  assert.equal(pageRequest.method, "POST");
  assert.deepEqual(pageRequest.body, {
    url: "https://example.com/product",
    maxRetries: 2,
    tokenCap: 75,
  });
  assert.deepEqual(Object.fromEntries(pageRequest.url.searchParams), {
    token: "e2e-api-key",
    timeout: "5",
    geoCode: "ID",
    browserRendering: "true",
    html: "true",
    markdown: "false",
    waitForSelector: ".product",
    warmStart: "true",
    blockResources: "true",
  });

  const searchRequest = requests.find(
    ({ url }) => url.pathname === "/sync/api/google/serp/v2/sync",
  );
  assert.deepEqual(searchRequest.body, {
    query: "iphone 17",
    region: "id",
    language: "id",
    page: 2,
    format: "html",
    renderJs: true,
  });

  const logout = await runCli(["logout"], environment);
  assert.equal(logout.code, 0);
  const loggedOutStatus = await runCli(["auth", "status", "--json"], environment);
  assert.equal(JSON.parse(loggedOutStatus.stdout).credential_configured, false);
});
