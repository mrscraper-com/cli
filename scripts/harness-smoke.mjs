// Exercise the installed CLI against a local mock API for one agent harness.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const harness = process.argv[2];
if (!harness) throw new Error("Expected a MrScraper harness ID");

const apiKey = "harness-smoke-api-key";
const outputPath = path.join(os.tmpdir(), `mrscraper-${harness}-product.json`);

function quote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

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
  const content = Buffer.concat(chunks).toString("utf8");
  return content ? JSON.parse(content) : null;
}

function run(args, options = {}) {
  const shownArgs = options.shownArgs ?? args;
  process.stdout.write(`\n$ mrscraper ${shownArgs.map(quote).join(" ")}\n`);

  return new Promise((resolve, reject) => {
    execFile(
      "mrscraper",
      args,
      {
        env: options.environment,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (stderr) process.stdout.write(stderr);
        if (stdout) process.stdout.write(stdout);
        if (error) {
          reject(
            new Error(
              `Command failed with ${typeof error.code === "number" ? `exit ${error.code}` : error.message}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}

const server = http.createServer(async (request, response) => {
  try {
    if (
      request.headers.authorization !== `Bearer ${apiKey}` ||
      request.headers["x-api-token"] !== apiKey
    ) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"message":"unauthorized"}');
      return;
    }

    const url = new URL(request.url, "http://localhost");
    const body = request.method === "POST" ? await readJsonBody(request) : null;

    if (url.pathname === "/fetch") {
      response.writeHead(200, {
        "content-type": "text/html",
        "x-request-id": `${harness}-fetch`,
      });
      response.end("<html><body>MrScraper harness smoke page</body></html>");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });

    if (url.pathname === "/api/v1/scrapers-ai") {
      const data =
        body.agent === "map"
          ? ["https://example.com/product"]
          : { name: "Example product", price: "$10.00" };
      response.end(
        JSON.stringify({
          message: "Successful operation!",
          data: {
            id: `${body.agent}-result`,
            scraperId: "smoke-scraper",
            status: "Finished",
            data,
          },
        }),
      );
      return;
    }

    if (url.pathname === "/sync/api/google/serp/v2/sync") {
      response.end(
        JSON.stringify({
          success: true,
          data: [{ title: "Example", link: "https://example.com" }],
        }),
      );
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
              name: "Harness Smoke",
              email: "smoke@example.com",
              isVerified: true,
            },
          },
        }),
      );
      return;
    }

    if (url.pathname === "/api/v1/analytic/statuses") {
      response.end(
        JSON.stringify({ data: { countAll: 4, successRate: 100 } }),
      );
      return;
    }

    if (url.pathname === "/api/v1/scrapers-ai-rerun") {
      response.end(
        JSON.stringify({ data: { id: "ai-rerun", status: "Finished" } }),
      );
      return;
    }

    if (url.pathname === "/api/v1/scrapers-manual-rerun/bulk") {
      response.end(
        JSON.stringify({ data: { id: "manual-bulk", status: "Running" } }),
      );
      return;
    }

    if (url.pathname === "/api/v1/results/smoke-result") {
      response.end(
        JSON.stringify({
          data: {
            id: "smoke-result",
            data: { name: "Example product", price: "$10.00" },
          },
        }),
      );
      return;
    }

    if (url.pathname === "/api/v1/results") {
      response.end(
        JSON.stringify({
          data: [{ id: "smoke-result" }],
          meta: { page: 1, pageSize: 10 },
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
const environment = {
  ...process.env,
  MRSCRAPER_API_KEY: "",
  MRSCRAPER_API_TOKEN: "",
  MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/fetch`,
  MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}/sync`,
};

try {
  process.stdout.write(`\nMrScraper CLI command verification for ${harness}\n`);

  await run(["--version"], { environment });
  await run(["login", "--api-key", apiKey], {
    environment,
    shownArgs: ["login", "--api-key", "<redacted>"],
  });
  await run(["auth", "status", "--json"], { environment });
  await run(["setup", "skills", "--agent", harness, "--dry-run"], {
    environment,
  });
  await run(
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
    { environment },
  );
  await run(
    [
      "scrape",
      "https://example.com/product",
      "--prompt",
      "Extract the product name and price",
      "--schema-prompt",
      "/workspace/test/fixtures/product.schema.json",
      "--proxy-country",
      "ID",
      "--output",
      outputPath,
    ],
    { environment },
  );
  await run(
    [
      "scrape",
      "https://example.com/products",
      "--agent",
      "listing",
      "--prompt",
      "Extract every product",
      "--max-pages",
      "2",
    ],
    { environment },
  );
  await run(
    [
      "scrape",
      "https://example.com",
      "--agent",
      "map",
      "--max-pages",
      "2",
      "--max-depth",
      "1",
      "--limit",
      "5",
      "--include-patterns",
      "/product/",
      "--exclude-patterns",
      "/account/",
    ],
    { environment },
  );
  await run(
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
      "json",
      "--render-js",
      "--client-timeout",
      "5",
    ],
    { environment },
  );
  await run(
    [
      "status",
      "--json",
      "--domain",
      "example.com",
      "--from",
      "24h",
      "--to",
      "2026-08-18T00:00:00Z",
    ],
    { environment },
  );
  await run(
    [
      "rerun",
      "https://example.com/product-2",
      "--type",
      "ai",
      "--scraper-id",
      "smoke-scraper",
    ],
    { environment },
  );
  await run(
    [
      "rerun",
      "https://a.example,https://b.example",
      "--bulk",
      "--type",
      "manual",
      "--id",
      "manual-scraper",
    ],
    { environment },
  );
  await run(
    [
      "results",
      "--page-size",
      "10",
      "--page",
      "1",
      "--sort-field",
      "updatedAt",
      "--sort-order",
      "DESC",
      "--search",
      "example.com",
    ],
    { environment },
  );
  await run(["result", "smoke-result"], { environment });
  await run(["logout"], { environment });
  await run(["auth", "status", "--json"], { environment });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Expected scrape output at ${outputPath}`);
  }

  process.stdout.write(`\nPASS: ${harness}\n`);
} finally {
  await close(server);
}
