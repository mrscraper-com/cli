import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  authStatus,
  buildAuthHeaders,
  exchangeBrowserLoginCode,
  loginWithBrowser,
  logout,
  runWithAuth,
} from "../lib/auth.js";
import { authPath, loadAuth, saveApiKey } from "../lib/config-store.js";

function temporaryHome(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mrscraper-browser-auth-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function jsonResponse(response, body, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

test("browser login exchanges a PKCE code and atomically stores its API key", async (t) => {
  const authHome = temporaryHome(t);
  let authorizationUrl;
  let exchangeBody;
  let callbackRequest;
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      assert.equal(request.url, "/api/v1/auth/cli/exchange");
      exchangeBody = JSON.parse(body);
      jsonResponse(response, { data: { token: "browser-issued-api-key" } });
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = {
    MRSCRAPER_HOME: authHome,
    MRSCRAPER_APP_URL: "https://app.mrscraper.test",
    MRSCRAPER_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  };
  const messages = [];

  const result = await loginWithBrowser({
    environment,
    log: (message) => messages.push(message),
    openBrowserFn: async (url) => {
      authorizationUrl = new URL(url);
      const callback = new URL(
        authorizationUrl.searchParams.get("cli_redirect"),
      );
      callback.searchParams.set("code", "single-use-code");
      callback.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state"),
      );
      callbackRequest = fetch(callback);
      return true;
    },
  });
  await callbackRequest;

  assert.equal(exchangeBody.code, "single-use-code");
  const expectedChallenge = createHash("sha256")
    .update(exchangeBody.codeVerifier)
    .digest("base64url");
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge"),
    expectedChallenge,
  );
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  assert.equal(result.path, path.join(authHome, "auth.json"));
  assert.deepEqual(loadAuth({ environment }), {
    version: 1,
    auth_type: "api_key",
    api_key: "browser-issued-api-key",
  });
  assert.doesNotMatch(messages.join("\n"), /browser-issued-api-key/);
});

test("a failed browser exchange never creates auth.json or leaks its response", async (t) => {
  const authHome = temporaryHome(t);
  const environment = { MRSCRAPER_HOME: authHome };

  await assert.rejects(
    loginWithBrowser({
      environment,
      log: () => {},
      browserLoginFn: async () => ({
        code: "rejected-code",
        codeVerifier: "private-verifier",
      }),
      exchangeCodeFn: async () => {
        throw new Error("Browser login exchange failed with HTTP 401");
      },
    }),
    /HTTP 401/,
  );
  assert.equal(fs.existsSync(path.join(authHome, "auth.json")), false);
});

test("browser exchange errors never reflect backend secrets", async () => {
  await assert.rejects(
    exchangeBrowserLoginCode(
      { code: "rejected-code", codeVerifier: "private-verifier" },
      {
        environment: {
          MRSCRAPER_API_BASE_URL: "https://api.example.test/api/v1",
        },
        fetchFn: async () =>
          Response.json(
            {
              error: "request_failed",
              message: "accidentally returned secret-api-key",
            },
            { status: 401 },
          ),
      },
    ),
    (error) => {
      assert.match(error.message, /HTTP 401: request_failed/);
      assert.doesNotMatch(error.message, /secret-api-key/);
      assert.doesNotMatch(error.message, /private-verifier|rejected-code/);
      return true;
    },
  );
});

test("exchange accepts the backend's nested and direct API-key response shapes", async () => {
  for (const payload of [
    { data: { data: { token: "nested-key" } } },
    { api_key: "direct-key" },
  ]) {
    const apiKey = await exchangeBrowserLoginCode(
      { code: "code", codeVerifier: "verifier" },
      {
        environment: {
          MRSCRAPER_API_BASE_URL: "https://api.example.test/api/v1",
        },
        fetchFn: async () => Response.json(payload),
      },
    );
    assert.equal(apiKey, payload.api_key || "nested-key");
  }
});

test("API-key headers retain legacy service compatibility", () => {
  assert.deepEqual(
    buildAuthHeaders({ auth_type: "api_key", api_key: "api-secret" }),
    {
      Authorization: "Bearer api-secret",
      "x-api-token": "api-secret",
    },
  );
  assert.throws(
    () => buildAuthHeaders({ auth_type: "oauth", access_token: "old" }),
    /API key is required/,
  );
});

test("explicit and environment API keys override the saved key", async (t) => {
  const homeDirectory = temporaryHome(t);
  saveApiKey("saved-key", { homeDirectory, environment: {} });

  const saved = await runWithAuth(undefined, async (credential) => credential, {
    homeDirectory,
    environment: {},
  });
  const environment = await runWithAuth(
    undefined,
    async (credential) => credential,
    {
      homeDirectory,
      environment: { MRSCRAPER_API_KEY: "environment-key" },
    },
  );
  const explicit = await runWithAuth(
    "explicit-key",
    async (credential) => credential,
    {
      homeDirectory,
      environment: { MRSCRAPER_API_KEY: "environment-key" },
    },
  );

  assert.equal(saved.api_key, "saved-key");
  assert.equal(environment.api_key, "environment-key");
  assert.equal(explicit.api_key, "explicit-key");
});

test("logout removes local credentials", async (t) => {
  const homeDirectory = temporaryHome(t);
  const options = { homeDirectory, environment: {} };
  saveApiKey("saved-key", options);

  assert.deepEqual(await logout(options), { removed: true });
  assert.equal(fs.existsSync(authPath(options)), false);
});

test("auth status exposes metadata but never credentials", (t) => {
  const homeDirectory = temporaryHome(t);
  const options = { homeDirectory, environment: {} };
  saveApiKey("never-print-me", options);

  const status = authStatus(options);
  assert.deepEqual(status, {
    authenticated: true,
    auth_type: "api_key",
    path: authPath(options),
  });
  assert.doesNotMatch(JSON.stringify(status), /never-print-me/);
});

test("auth status reports an environment override without exposing it", (t) => {
  const homeDirectory = temporaryHome(t);
  const status = authStatus({
    homeDirectory,
    environment: { MRSCRAPER_API_KEY: "environment-secret" },
  });

  assert.deepEqual(status, {
    authenticated: true,
    auth_type: "api_key",
    source: "MRSCRAPER_API_KEY",
  });
  assert.doesNotMatch(JSON.stringify(status), /environment-secret/);
});
