import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = process.env.MRSCRAPER_E2E_CLI_PATH ?? path.join(repositoryRoot, "bin/mrscraper.js");

function runCli(args, environment) {
  const executable = process.env.MRSCRAPER_E2E_EXECUTABLE;
  return new Promise((resolve, reject) => {
    execFile(executable || process.execPath, executable ? args : [cliPath, ...args], {
      cwd: repositoryRoot, env: { ...process.env, ...environment }, timeout: 15_000,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${args[0]} failed: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

test("installed CLI authenticates and reaches exactly the three supported data operations", async (t) => {
  const credentialDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-e2e-"));
  t.after(() => fs.rmSync(credentialDir, { recursive: true, force: true }));
  const calls = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? JSON.parse(text) : null;
      calls.push({ method: request.method, url, body });
      assert.equal(request.headers.authorization, "Bearer e2e-key");
      assert.equal(request.headers["x-api-token"], "e2e-key");
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/scraper") {
        assert.equal(request.method, "POST");
        assert.deepEqual(body, { url: "https://books.toscrape.com/", maxRetries: 3 });
        assert.equal(url.searchParams.get("markdown"), "true");
        response.end('{"html":"<html>Books</html>","markdown":"Books"}');
      } else if (url.pathname === "/sync/api/google/serp/v2/sync") {
        assert.equal(request.method, "POST");
        assert.deepEqual(body, { query: "books", format: "json", renderJs: false });
        response.end('{"results":[{"url":"https://books.toscrape.com/"}]}');
      } else if (url.pathname === "/api/v1/subscription-accounts") {
        assert.equal(request.method, "GET");
        assert.equal(body, null);
        response.end(JSON.stringify({ data: {
          tokenLimit: 1000, tokenUsage: 125, stripeStatus: "active", stripeCustomerId: "billing-secret",
          user: { name: "Ada", email: "ada@example.com", isVerified: true, latestApiToken: "private-key" },
        } }));
      } else {
        response.statusCode = 404;
        response.end('{"error":"unexpected endpoint"}');
      }
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const environment = {
    MRSCRAPER_HOME: credentialDir, MRSCRAPER_API_KEY: "", MRSCRAPER_API_TOKEN: "",
    MRSCRAPER_FETCH_BASE_URL: `http://127.0.0.1:${port}/scraper`,
    MRSCRAPER_SYNC_BASE_URL: `http://127.0.0.1:${port}/sync`,
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  };
  await runCli(["login", "--api-key", "e2e-key"], environment);
  const auth = JSON.parse(await runCli(["auth", "status", "--json"], environment));
  assert.equal(auth.credential_configured, true);
  const harness = process.env.MRSCRAPER_E2E_HARNESS || "codex";
  await runCli(["setup", "skills", "--agent", harness, "--dry-run"], environment);
  const page = JSON.parse(await runCli(["scraperAPI", "https://books.toscrape.com/", "--markdown"], environment));
  assert.equal(page.status_code, 200);
  assert.equal(page.data.markdown, "Books");
  const search = JSON.parse(await runCli(["webSearch", "books"], environment));
  assert.equal(search.data.results[0].url, "https://books.toscrape.com/");
  const accountText = await runCli(["account", "--json"], environment);
  const account = JSON.parse(accountText);
  assert.equal(account.data.account.subscription_status, "active");
  assert.equal(account.data.account.token_remaining, 875);
  assert.doesNotMatch(accountText, /billing-secret|private-key/);
  assert.deepEqual(calls.map(({ method, url }) => [method, url.pathname]), [
    ["POST", "/scraper"], ["POST", "/sync/api/google/serp/v2/sync"], ["GET", "/api/v1/subscription-accounts"],
  ]);
  await runCli(["logout"], environment);
  const loggedOut = JSON.parse(await runCli(["auth", "status", "--json"], environment));
  assert.equal(loggedOut.credential_configured, false);
});
