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
  loginWithOAuth,
  logout,
  runWithAuth,
} from "../lib/auth.js";
import { authPath, loadAuth, saveApiKey, saveAuth } from "../lib/config-store.js";

function temporaryHome(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-oauth-"));
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

function oauthEnvironment(baseUrl) {
  return {
    MRSCRAPER_OAUTH_AUTHORIZE_URL: `${baseUrl}/oauth/authorize`,
    MRSCRAPER_OAUTH_TOKEN_URL: `${baseUrl}/oauth/token`,
    MRSCRAPER_OAUTH_REVOKE_URL: `${baseUrl}/oauth/revoke`,
    MRSCRAPER_OAUTH_CLIENT_ID: "mrscraper-cli-test",
    MRSCRAPER_OAUTH_SCOPE: "scrape:read offline_access",
  };
}

function jsonResponse(response, body, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

test("browser OAuth uses PKCE and stores the returned session in auth.json", async (t) => {
  const homeDirectory = temporaryHome(t);
  let authorizationUrl;
  let callbackRequest;
  const tokenForms = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url !== "/oauth/token") {
        response.writeHead(404).end();
        return;
      }
      const form = new URLSearchParams(body);
      tokenForms.push(form);
      const expectedChallenge = createHash("sha256")
        .update(form.get("code_verifier"))
        .digest("base64url");
      assert.equal(
        expectedChallenge,
        new URL(authorizationUrl).searchParams.get("code_challenge"),
      );
      jsonResponse(response, {
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "scrape:read offline_access",
      });
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);
  const messages = [];

  const result = await loginWithOAuth({
    environment,
    homeDirectory,
    log: (message) => messages.push(message),
    openBrowser: async (url) => {
      authorizationUrl = url;
      const parsed = new URL(url);
      const callback = new URL(parsed.searchParams.get("redirect_uri"));
      callback.searchParams.set("code", "one-time-code");
      callback.searchParams.set("state", parsed.searchParams.get("state"));
      callbackRequest = fetch(callback);
      return true;
    },
  });
  await callbackRequest;

  assert.equal(tokenForms.length, 1);
  assert.equal(tokenForms[0].get("grant_type"), "authorization_code");
  assert.equal(tokenForms[0].get("client_id"), "mrscraper-cli-test");
  assert.equal(tokenForms[0].get("code"), "one-time-code");
  assert.equal(tokenForms[0].get("redirect_uri").startsWith("http://127.0.0.1:"), true);
  assert.equal(new URL(authorizationUrl).searchParams.get("code_challenge_method"), "S256");
  assert.equal(new URL(authorizationUrl).searchParams.get("scope"), "scrape:read offline_access");
  assert.equal(result.path, authPath({ environment, homeDirectory }));
  assert.deepEqual(loadAuth({ environment, homeDirectory }), result.auth);
  assert.match(messages.join("\n"), /Saved OAuth credentials/);
});

test("browser OAuth rejects a callback with the wrong state", async (t) => {
  const homeDirectory = temporaryHome(t);
  const server = http.createServer((_request, response) => {
    jsonResponse(response, { error: "token endpoint should not be called" }, 500);
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);

  await assert.rejects(
    loginWithOAuth({
      environment,
      homeDirectory,
      log: () => {},
      openBrowser: async (url) => {
        const callback = new URL(new URL(url).searchParams.get("redirect_uri"));
        callback.searchParams.set("code", "stolen-code");
        callback.searchParams.set("state", "wrong-state");
        void fetch(callback);
        return true;
      },
    }),
    /state did not match/,
  );
  assert.equal(fs.existsSync(authPath({ environment, homeDirectory })), false);
});

test("OAuth bearer headers never copy the access token into x-api-token", () => {
  assert.deepEqual(
    buildAuthHeaders({ auth_type: "oauth", access_token: "oauth-secret" }),
    { Authorization: "Bearer oauth-secret" },
  );
  assert.deepEqual(buildAuthHeaders({ auth_type: "api_key", api_key: "api-secret" }), {
    Authorization: "Bearer api-secret",
    "x-api-token": "api-secret",
  });
});

test("parallel commands serialize refresh-token rotation", async (t) => {
  const homeDirectory = temporaryHome(t);
  let refreshRequests = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "refresh-old");
      refreshRequests += 1;
      setTimeout(
        () =>
          jsonResponse(response, {
            access_token: "access-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        50,
      );
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);
  saveAuth(
    {
      version: 1,
      auth_type: "oauth",
      access_token: "access-old",
      refresh_token: "refresh-old",
      expires_at: Date.now() - 1,
      scope: "scrape:read offline_access",
    },
    { environment, homeDirectory },
  );
  const seen = [];

  const results = await Promise.all([
    runWithAuth(undefined, async (credential) => {
      seen.push(credential.access_token);
      return { status_code: 200 };
    }, { environment, homeDirectory }),
    runWithAuth(undefined, async (credential) => {
      seen.push(credential.access_token);
      return { status_code: 200 };
    }, { environment, homeDirectory }),
  ]);

  assert.deepEqual(results, [{ status_code: 200 }, { status_code: 200 }]);
  assert.deepEqual(seen, ["access-new", "access-new"]);
  assert.equal(refreshRequests, 1);
  assert.equal(loadAuth({ environment, homeDirectory }).refresh_token, "refresh-new");
  assert.equal(
    loadAuth({ environment, homeDirectory }).scope,
    "scrape:read offline_access",
  );
});

test("a stored OAuth session refreshes once and retries an unauthorized request", async (t) => {
  const homeDirectory = temporaryHome(t);
  let refreshRequests = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      refreshRequests += 1;
      jsonResponse(response, {
        access_token: "access-retried",
        refresh_token: "refresh-retried",
        expires_in: 3600,
        token_type: "Bearer",
      });
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);
  saveAuth(
    {
      version: 1,
      auth_type: "oauth",
      access_token: "access-rejected",
      refresh_token: "refresh-current",
      expires_at: Date.now() + 3600_000,
    },
    { environment, homeDirectory },
  );
  const attempts = [];

  const result = await runWithAuth(
    undefined,
    async (credential) => {
      attempts.push(credential.access_token);
      return {
        status_code: credential.access_token === "access-rejected" ? 401 : 200,
      };
    },
    { environment, homeDirectory },
  );

  assert.equal(result.status_code, 200);
  assert.deepEqual(attempts, ["access-rejected", "access-retried"]);
  assert.equal(refreshRequests, 1);
});

test("explicit and environment API keys override stored OAuth without refreshing it", async (t) => {
  const homeDirectory = temporaryHome(t);
  saveAuth(
    {
      version: 1,
      auth_type: "oauth",
      access_token: "expired-access",
      refresh_token: "refresh-secret",
      expires_at: 1,
    },
    { homeDirectory, environment: {} },
  );

  const environmentResult = await runWithAuth(
    undefined,
    async (credential) => credential,
    { homeDirectory, environment: { MRSCRAPER_API_KEY: "environment-key" } },
  );
  const explicitResult = await runWithAuth(
    "explicit-key",
    async (credential) => credential,
    { homeDirectory, environment: { MRSCRAPER_API_KEY: "environment-key" } },
  );

  assert.deepEqual(environmentResult, {
    auth_type: "api_key",
    api_key: "environment-key",
  });
  assert.deepEqual(explicitResult, {
    auth_type: "api_key",
    api_key: "explicit-key",
  });
});

test("logout revokes OAuth and always removes the local auth file", async (t) => {
  const homeDirectory = temporaryHome(t);
  let revokeForm;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      revokeForm = new URLSearchParams(body);
      jsonResponse(response, {});
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);
  saveAuth(
    {
      version: 1,
      auth_type: "oauth",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_at: Date.now() + 3600_000,
    },
    { environment, homeDirectory },
  );

  const result = await logout({ environment, homeDirectory });

  assert.deepEqual(result, { removed: true, revoked: true, revocationError: null });
  assert.equal(revokeForm.get("token"), "refresh-secret");
  assert.equal(revokeForm.get("token_type_hint"), "refresh_token");
  assert.equal(fs.existsSync(authPath({ environment, homeDirectory })), false);
});

test("logout still removes local OAuth credentials when revocation fails", async (t) => {
  const homeDirectory = temporaryHome(t);
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      jsonResponse(response, { error: "temporarily_unavailable" }, 503);
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const environment = oauthEnvironment(`http://127.0.0.1:${port}`);
  saveAuth(
    {
      version: 1,
      auth_type: "oauth",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_at: Date.now() + 3600_000,
    },
    { environment, homeDirectory },
  );

  const result = await logout({ environment, homeDirectory });

  assert.equal(result.removed, true);
  assert.equal(result.revoked, false);
  assert.match(result.revocationError, /HTTP 503/);
  assert.equal(fs.existsSync(authPath({ environment, homeDirectory })), false);
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
