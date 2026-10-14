// Exercise the installed CLI against a local mock API for one agent harness.
import { execFile } from "node:child_process";
import http from "node:http";

const harness = process.argv[2];
if (!harness) throw new Error("Expected a MrScraper harness ID");

const apiKey = "harness-smoke-api-key";

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

    if (url.pathname === "/scraper") {
      response.writeHead(200, {
        "content-type": "text/html",
        "x-request-id": `${harness}-scraper-api`,
      });
      response.end("<html><body>MrScraper harness smoke page</body></html>");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });

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
  MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/scraper`,
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
    { environment },
  );
  await run(
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
      "json",
      "--render-js",
      "--timeout",
      "5",
    ],
    { environment },
  );
  await run(["status", "--json"], { environment });
  await run(["logout"], { environment });
  await run(["auth", "status", "--json"], { environment });

  process.stdout.write(`\nPASS: ${harness}\n`);
} finally {
  await close(server);
}
