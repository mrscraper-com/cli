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
  const extracted = {
    name: "Example product",
    token: "legitimate extracted token field",
    password: "legitimate extracted password field",
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const body = request.method === "POST" ? await readJsonBody(request) : null;
      requests.push({ method: request.method, url, body, headers: request.headers });

      assert.equal(request.headers.authorization, "Bearer e2e-api-key");
      assert.equal(request.headers["x-api-token"], "e2e-api-key");

      if (url.pathname === "/fetch") {
        response.writeHead(200, { "content-type": "text/html", "x-request-id": "fetch-1" });
        response.end("<html><body>token=public-page-value</body></html>");
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/api/v1/scrapers-ai") {
        response.end(
          JSON.stringify({
            message: "Successful operation!",
            data: {
              id: body.agent === "map" ? "map-result" : "scrape-result",
              scraperId: "scraper-1",
              status: "Finished",
              data: body.agent === "map" ? ["https://example.com/product"] : extracted,
              curl: "curl -H 'x-api-token: atk_fakefakefakefake'",
            },
          }),
        );
        return;
      }
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
      if (url.pathname === "/api/v1/analytic/statuses") {
        response.end(JSON.stringify({ data: { countAll: 4, successRate: 100 } }));
        return;
      }
      if (url.pathname === "/api/v1/scrapers-ai-rerun") {
        response.end(JSON.stringify({ data: { id: "ai-rerun", status: "Finished" } }));
        return;
      }
      if (url.pathname === "/api/v1/scrapers-manual-rerun/bulk") {
        response.end(JSON.stringify({ data: { id: "manual-bulk", status: "Running" } }));
        return;
      }
      if (url.pathname === "/api/v1/results/e2e-result") {
        response.end(JSON.stringify({ data: { id: "e2e-result", data: extracted } }));
        return;
      }
      if (url.pathname === "/api/v1/results") {
        response.end(JSON.stringify({ data: [{ id: "e2e-result" }], meta: { page: 2 } }));
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
    MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/fetch`,
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}/sync`,
  };

  const login = await runCli(["login", "--api-key", "e2e-api-key"], environment);
  assert.equal(login.code, 0);
  const authStatus = await runCli(["auth", "status", "--json"], environment);
  assert.equal(JSON.parse(authStatus.stdout).credential_configured, true);

  const fetchResult = await runCli(
    [
      "fetch",
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
  assert.equal(fetchResult.code, 0);
  assert.equal(
    JSON.parse(fetchResult.stdout).data,
    "<html><body>token=public-page-value</body></html>",
  );

  const outputPath = path.join(temporaryRoot, "product.json");
  const scrapeResult = await runCli(
    [
      "scrape",
      "https://example.com/product",
      "--prompt",
      "Extract the product",
      "--schema-prompt",
      path.join(repositoryRoot, "test", "fixtures", "product.schema.json"),
      "--output",
      outputPath,
    ],
    environment,
  );
  assert.equal(scrapeResult.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), extracted);
  assert.match(JSON.parse(scrapeResult.stdout).data.data.curl, /REDACTED/);

  const mapResult = await runCli(
    [
      "scrape",
      "https://example.com",
      "--agent",
      "map",
      "--max-depth",
      "2",
      "--include-patterns",
      "/product/",
    ],
    environment,
  );
  assert.equal(mapResult.code, 0);

  const serpResult = await runCli(
    [
      "serp",
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
      "--client-timeout",
      "5",
    ],
    environment,
  );
  assert.equal(serpResult.code, 0);

  const statusResult = await runCli(
    [
      "status",
      "--json",
      "--domain",
      "https://www.example.com/products",
      "--from",
      "24h",
      "--to",
      "2026-08-18T00:00:00Z",
    ],
    environment,
  );
  assert.equal(statusResult.code, 0);
  assert.equal(JSON.parse(statusResult.stdout).kind, "mrscraper-cli-status-summary");

  const aiRerun = await runCli(
    [
      "rerun",
      "https://example.com/product-2",
      "--type",
      "ai",
      "--scraper-id",
      "scraper-1",
    ],
    environment,
  );
  assert.equal(aiRerun.code, 0);

  const manualBulk = await runCli(
    [
      "rerun",
      "https://a.example,https://b.example",
      "--bulk",
      "--type",
      "manual",
      "--id",
      "manual-1",
    ],
    environment,
  );
  assert.equal(manualBulk.code, 0);

  const results = await runCli(
    ["results", "--page-size", "20", "--page", "2", "--sort-order", "asc"],
    environment,
  );
  assert.equal(results.code, 0);
  const result = await runCli(["result", "e2e-result"], environment);
  assert.equal(result.code, 0);

  const fetchRequest = requests.find(({ url }) => url.pathname === "/fetch");
  assert.equal(requests.filter(({ url }) => url.pathname === "/fetch").length, 1);
  assert.equal(fetchRequest.url.searchParams.get("browserRendering"), "true");
  assert.equal(fetchRequest.url.searchParams.get("geoCode"), "ID");
  assert.equal(fetchRequest.url.searchParams.get("waitForSelector"), ".product");
  assert.equal(fetchRequest.url.searchParams.get("homePage"), "true");
  assert.equal(fetchRequest.url.searchParams.get("blockResources"), "true");
  assert.equal(fetchRequest.url.searchParams.get("maxRetries"), "2");
  assert.equal(fetchRequest.url.searchParams.get("tokenCap"), "75");
  assert.equal(fetchRequest.url.searchParams.get("timeout"), "5");

  const scrapeRequests = requests.filter(
    ({ url }) => url.pathname === "/api/v1/scrapers-ai",
  );
  assert.match(scrapeRequests[0].body.message, /does not validate this schema/);
  assert.equal(scrapeRequests[0].body.schema, undefined);
  assert.deepEqual(scrapeRequests[1].body, {
    url: "https://example.com",
    agent: "map",
    maxDepth: 2,
    includePatterns: "/product/",
  });

  const serpRequest = requests.find(
    ({ url }) => url.pathname === "/sync/api/google/serp/v2/sync",
  );
  assert.deepEqual(serpRequest.body, {
    query: "iphone 17",
    format: "html",
    renderJs: true,
    region: "id",
    language: "id",
    page: 2,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(serpRequest.body, "timeout"), false);

  const aiRerunRequest = requests.find(
    ({ url }) => url.pathname === "/api/v1/scrapers-ai-rerun",
  );
  assert.deepEqual(aiRerunRequest.body, {
    scraperId: "scraper-1",
    url: "https://example.com/product-2",
    maxDepth: 2,
    maxPages: 50,
    limit: 1000,
    includePatterns: "",
    excludePatterns: "",
  });
  const manualBulkRequest = requests.find(
    ({ url }) => url.pathname === "/api/v1/scrapers-manual-rerun/bulk",
  );
  assert.deepEqual(manualBulkRequest.body, {
    scraperId: "manual-1",
    urls: ["https://a.example", "https://b.example"],
  });

  const resultsRequest = requests.find(({ url }) => url.pathname === "/api/v1/results");
  assert.equal(resultsRequest.url.searchParams.get("pageSize"), "20");
  assert.equal(resultsRequest.url.searchParams.get("page"), "2");
  assert.equal(resultsRequest.url.searchParams.get("sortOrder"), "ASC");

  const logout = await runCli(["logout"], environment);
  assert.equal(logout.code, 0);
  const loggedOutStatus = await runCli(["auth", "status", "--json"], environment);
  assert.equal(JSON.parse(loggedOutStatus.stdout).credential_configured, false);
});
