import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  authLockPath,
  authPath,
  clearAuth,
  ensureConfigDir,
  loadAuth,
  saveAuth,
} from "./config-store.js";

export const DEFAULT_OAUTH_AUTHORIZE_URL =
  "https://app.mrscraper.com/oauth/authorize";
export const DEFAULT_OAUTH_TOKEN_URL =
  "https://api.app.mrscraper.com/oauth/token";
export const DEFAULT_OAUTH_REVOKE_URL =
  "https://api.app.mrscraper.com/oauth/revoke";
export const DEFAULT_OAUTH_CLIENT_ID = "mrscraper-cli";
export const DEFAULT_OAUTH_SCOPE =
  "scrape:read scrape:write account:read offline_access";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/oauth/callback";
const EXPIRY_SKEW_MS = 60_000;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {unknown} value */
function safeErrorDetail(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
}

/** @param {string} left @param {string} right */
function secureStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/** @param {string} url @param {string} label */
function validateOAuthUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`${label} must use HTTPS unless it targets a loopback host`);
  }
  return parsed.toString();
}

/** @param {NodeJS.ProcessEnv} [environment] */
export function oauthConfig(environment = process.env) {
  const authorizeUrl = validateOAuthUrl(
    environment.MRSCRAPER_OAUTH_AUTHORIZE_URL || DEFAULT_OAUTH_AUTHORIZE_URL,
    "OAuth authorization endpoint",
  );
  const tokenUrl = validateOAuthUrl(
    environment.MRSCRAPER_OAUTH_TOKEN_URL || DEFAULT_OAUTH_TOKEN_URL,
    "OAuth token endpoint",
  );
  const revokeUrl = validateOAuthUrl(
    environment.MRSCRAPER_OAUTH_REVOKE_URL || DEFAULT_OAUTH_REVOKE_URL,
    "OAuth revocation endpoint",
  );
  const clientId = (
    environment.MRSCRAPER_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID
  ).trim();
  const scope = (
    environment.MRSCRAPER_OAUTH_SCOPE || DEFAULT_OAUTH_SCOPE
  ).trim();
  if (!clientId) throw new Error("OAuth client ID cannot be empty");
  return { authorizeUrl, tokenUrl, revokeUrl, clientId, scope };
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * @param {string} url
 * @param {{platform?: NodeJS.Platform, spawnFn?: typeof spawn}} [options]
 * @returns {Promise<boolean>}
 */
export function openBrowserUrl(url, options = {}) {
  const platform = options.platform || process.platform;
  const spawnFn = options.spawnFn || spawn;
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(command, args, { detached: true, stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/**
 * @param {string} url
 * @param {URLSearchParams} form
 * @param {{fetchFn?: typeof fetch, timeoutMs?: number}} [options]
 */
async function postOAuthForm(url, form, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs || OAUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const body = await response.text();
    let data = null;
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const detail = safeErrorDetail(data?.error_description || data?.error);
      throw new Error(
        `OAuth request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OAuth request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {Record<string, unknown>} response
 * @param {{now?: number, previousRefreshToken?: string, previousScope?: string, requireNewRefreshToken?: boolean}} [options]
 */
function tokenResponseToAuth(response, options = {}) {
  const accessToken = response?.access_token;
  const refreshToken = response?.refresh_token || options.previousRefreshToken;
  const expiresIn = Number(response?.expires_in);
  const tokenType = response?.token_type || "Bearer";
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("OAuth token response did not include an access_token");
  }
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new Error("OAuth token response did not include a refresh_token");
  }
  if (options.requireNewRefreshToken && !response?.refresh_token) {
    throw new Error("OAuth login response did not include a refresh_token");
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("OAuth token response did not include a valid expires_in");
  }
  if (String(tokenType).toLowerCase() !== "bearer") {
    throw new Error(`Unsupported OAuth token type: ${tokenType}`);
  }

  const auth = {
    version: 1,
    auth_type: "oauth",
    access_token: accessToken.trim(),
    refresh_token: refreshToken.trim(),
    expires_at: (options.now ?? Date.now()) + Math.floor(expiresIn * 1000),
    token_type: "Bearer",
  };
  const scope =
    typeof response.scope === "string" && response.scope.trim()
      ? response.scope.trim()
      : options.previousScope;
  if (scope) {
    auth.scope = scope;
  }
  return auth;
}

/** @param {http.Server} server */
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

/**
 * Perform the OAuth Authorization Code flow as a public client using PKCE and
 * an ephemeral loopback callback.
 *
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   homeDirectory?: string,
 *   platform?: NodeJS.Platform,
 *   fetchFn?: typeof fetch,
 *   openBrowser?: (url: string) => boolean | Promise<boolean>,
 *   noOpen?: boolean,
 *   timeoutMs?: number,
 *   log?: (message: string) => void,
 * }} [options]
 */
export async function loginWithOAuth(options = {}) {
  const environment = options.environment || process.env;
  const config = oauthConfig(environment);
  const log = options.log || console.log;
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = createPkcePair();
  let resolveCallback;
  let rejectCallback;
  let settled = false;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const finish = (operation, value) => {
    if (settled) return;
    settled = true;
    operation(value);
  };
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${CALLBACK_HOST}`);
    if (request.method !== "GET" || requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state") || "";
    const oauthError = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    if (!secureStringEqual(state, returnedState)) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid OAuth state. Return to the terminal and retry.");
      finish(rejectCallback, new Error("OAuth callback state did not match"));
      return;
    }
    if (oauthError) {
      const description = safeErrorDetail(
        requestUrl.searchParams.get("error_description") || oauthError,
      );
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("MrScraper authorization was not completed. Return to the terminal.");
      finish(rejectCallback, new Error(`OAuth authorization failed: ${description}`));
      return;
    }
    if (!code) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Missing authorization code. Return to the terminal and retry.");
      finish(rejectCallback, new Error("OAuth callback did not include a code"));
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      "<!doctype html><meta charset=\"utf-8\"><title>MrScraper login complete</title><h1>Login complete</h1><p>You can close this window and return to the terminal.</p>",
    );
    finish(resolveCallback, code);
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, CALLBACK_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.on("error", (error) => finish(rejectCallback, error));

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Unable to determine the OAuth callback address");
  }
  const redirectUri = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  if (config.scope) authorizeUrl.searchParams.set("scope", config.scope);

  const timeout = setTimeout(
    () => finish(rejectCallback, new Error("OAuth login timed out")),
    options.timeoutMs || LOGIN_TIMEOUT_MS,
  );
  try {
    const authorizationUrl = authorizeUrl.toString();
    let opened = false;
    if (!options.noOpen) {
      opened = await (options.openBrowser || openBrowserUrl)(authorizationUrl);
    }
    log(opened ? "Opened MrScraper login in your browser." : "Open this URL to log in:");
    log(authorizationUrl);

    const code = await callback;
    const tokenResponse = await postOAuthForm(
      config.tokenUrl,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      { fetchFn: options.fetchFn },
    );
    const auth = tokenResponseToAuth(tokenResponse, {
      requireNewRefreshToken: true,
    });
    const file = await withAuthLock(
      { environment, homeDirectory: options.homeDirectory },
      async () =>
        saveAuth(auth, {
          environment,
          homeDirectory: options.homeDirectory,
        }),
    );
    log(`Saved OAuth credentials to ${file}`);
    return { auth, path: file };
  } finally {
    clearTimeout(timeout);
    await closeServer(server);
  }
}

/**
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   homeDirectory?: string,
 *   waitTimeoutMs?: number,
 *   staleAfterMs?: number,
 * }} options
 * @param {() => Promise<unknown>} operation
 */
async function withAuthLock(options, operation) {
  const storeOptions = {
    environment: options.environment,
    homeDirectory: options.homeDirectory,
  };
  ensureConfigDir(storeOptions);
  const lockFile = authLockPath(storeOptions);
  const lockId = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + (options.waitTimeoutMs || 30_000);
  const staleAfterMs = options.staleAfterMs || 120_000;

  while (true) {
    let descriptor;
    let acquired = false;
    try {
      descriptor = fs.openSync(lockFile, "wx", 0o600);
      acquired = true;
      fs.writeFileSync(descriptor, `${lockId}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      break;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the acquisition error.
        }
      }
      if (acquired) {
        try {
          fs.unlinkSync(lockFile);
        } catch {
          // Preserve the acquisition error.
        }
      }
      if (error?.code !== "EEXIST") throw error;
      let age;
      try {
        age = Date.now() - fs.statSync(lockFile).mtimeMs;
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
        continue;
      }
      if (age > staleAfterMs) {
        try {
          fs.unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for another MrScraper token refresh");
      }
      await delay(50);
    }
  }

  try {
    return await operation();
  } finally {
    try {
      if (fs.readFileSync(lockFile, "utf8").trim() === lockId) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // A missing or replaced lock is already released from this process.
    }
  }
}

/**
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   homeDirectory?: string,
 *   fetchFn?: typeof fetch,
 *   force?: boolean,
 *   staleAccessToken?: string,
 *   now?: () => number,
 * }} [options]
 */
export async function refreshStoredOAuth(options = {}) {
  const environment = options.environment || process.env;
  const now = options.now || Date.now;
  return withAuthLock(
    { environment, homeDirectory: options.homeDirectory },
    async () => {
      const storeOptions = { environment, homeDirectory: options.homeDirectory };
      const current = loadAuth(storeOptions);
      if (!current || current.auth_type !== "oauth") {
        throw new Error("No saved OAuth session is available to refresh");
      }
      if (
        options.staleAccessToken &&
        current.access_token !== options.staleAccessToken
      ) {
        return current;
      }
      if (!options.force && current.expires_at > now() + EXPIRY_SKEW_MS) {
        return current;
      }

      const config = oauthConfig(environment);
      const response = await postOAuthForm(
        config.tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          refresh_token: current.refresh_token,
        }),
        { fetchFn: options.fetchFn },
      );
      const refreshed = tokenResponseToAuth(response, {
        now: now(),
        previousRefreshToken: current.refresh_token,
        previousScope: current.scope,
      });
      saveAuth(refreshed, storeOptions);
      return refreshed;
    },
  );
}

/** @param {string | {auth_type: string, api_key?: string, access_token?: string}} credential */
export function buildAuthHeaders(credential) {
  if (typeof credential === "string") {
    credential = { auth_type: "api_key", api_key: credential };
  }
  if (credential?.auth_type === "oauth") {
    const token = String(credential.access_token || "")
      .replace(/^bearer\s+/i, "")
      .trim();
    if (!token) throw new Error("OAuth access token is required");
    return { Authorization: `Bearer ${token}` };
  }
  if (credential?.auth_type === "api_key") {
    const key = String(credential.api_key || "")
      .replace(/^bearer\s+/i, "")
      .trim();
    if (!key) throw new Error("API key is required");
    return { Authorization: `Bearer ${key}`, "x-api-token": key };
  }
  throw new Error("Unsupported MrScraper authentication credential");
}

/** @param {Record<string, unknown>} auth */
function requestCredential(auth) {
  return auth.auth_type === "oauth"
    ? { auth_type: "oauth", access_token: auth.access_token }
    : { auth_type: "api_key", api_key: auth.api_key };
}

/**
 * @param {string | undefined} explicitToken
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   homeDirectory?: string,
 *   fetchFn?: typeof fetch,
 *   now?: () => number,
 * }} [options]
 */
async function resolveAuthContext(explicitToken, options = {}) {
  const environment = options.environment || process.env;
  const explicit = explicitToken?.trim();
  if (explicit) {
    return {
      credential: { auth_type: "api_key", api_key: explicit },
      refreshable: false,
    };
  }
  const environmentKey = (
    environment.MRSCRAPER_API_KEY || environment.MRSCRAPER_API_TOKEN
  )?.trim();
  if (environmentKey) {
    return {
      credential: { auth_type: "api_key", api_key: environmentKey },
      refreshable: false,
    };
  }

  const storeOptions = { environment, homeDirectory: options.homeDirectory };
  let stored = loadAuth(storeOptions);
  if (!stored) {
    throw new Error(
      "MrScraper authentication is required. Run `mrscraper login`, set MRSCRAPER_API_KEY, or pass --token.",
    );
  }
  if (stored.auth_type === "oauth") {
    const now = options.now || Date.now;
    if (stored.expires_at <= now() + EXPIRY_SKEW_MS) {
      stored = await refreshStoredOAuth({
        environment,
        homeDirectory: options.homeDirectory,
        fetchFn: options.fetchFn,
        now,
        staleAccessToken: stored.access_token,
      });
    }
  }
  return {
    credential: requestCredential(stored),
    refreshable: stored.auth_type === "oauth",
  };
}

/**
 * Resolve the configured credential, refresh OAuth before expiry, and retry a
 * single unauthorized API result after one forced refresh.
 *
 * @template T
 * @param {string | undefined} explicitToken
 * @param {(credential: Record<string, string>) => Promise<T>} operation
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, fetchFn?: typeof fetch, now?: () => number}} [options]
 * @returns {Promise<T>}
 */
export async function runWithAuth(explicitToken, operation, options = {}) {
  const context = await resolveAuthContext(explicitToken, options);
  const first = await operation(context.credential);
  if (
    !context.refreshable ||
    !first ||
    typeof first !== "object" ||
    first.status_code !== 401
  ) {
    return first;
  }

  const refreshed = await refreshStoredOAuth({
    environment: options.environment,
    homeDirectory: options.homeDirectory,
    fetchFn: options.fetchFn,
    now: options.now,
    force: true,
    staleAccessToken: context.credential.access_token,
  });
  return operation(requestCredential(refreshed));
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 */
export function authStatus(options = {}) {
  const environment = options.environment || process.env;
  if (environment.MRSCRAPER_API_KEY?.trim()) {
    return {
      authenticated: true,
      auth_type: "api_key",
      source: "MRSCRAPER_API_KEY",
    };
  }
  if (environment.MRSCRAPER_API_TOKEN?.trim()) {
    return {
      authenticated: true,
      auth_type: "api_key",
      source: "MRSCRAPER_API_TOKEN",
    };
  }
  const auth = loadAuth(options);
  if (!auth) return { authenticated: false, path: authPath(options) };
  if (auth.auth_type === "api_key") {
    return {
      authenticated: true,
      auth_type: "api_key",
      path: authPath(options),
    };
  }
  return {
    authenticated: true,
    auth_type: "oauth",
    expires_at: auth.expires_at,
    expired: auth.expires_at <= Date.now(),
    scope: auth.scope || null,
    path: authPath(options),
  };
}

/**
 * Attempt OAuth revocation for a stored OAuth session, then always remove all
 * local current and legacy credential files.
 *
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, fetchFn?: typeof fetch}} [options]
 */
export async function logout(options = {}) {
  const environment = options.environment || process.env;
  const storeOptions = { environment, homeDirectory: options.homeDirectory };
  return withAuthLock(storeOptions, async () => {
    const auth = loadAuth(storeOptions);
    let revoked = false;
    let revocationError = null;
    let removed = false;
    try {
      if (auth?.auth_type === "oauth") {
        const config = oauthConfig(environment);
        await postOAuthForm(
          config.revokeUrl,
          new URLSearchParams({
            client_id: config.clientId,
            token: auth.refresh_token,
            token_type_hint: "refresh_token",
          }),
          { fetchFn: options.fetchFn, timeoutMs: 10_000 },
        );
        revoked = true;
      }
    } catch (error) {
      revocationError = error instanceof Error ? error.message : String(error);
    } finally {
      removed = clearAuth(storeOptions);
    }
    return { removed, revoked, revocationError };
  });
}
