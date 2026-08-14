import { authPath, clearAuth, loadAuth, saveApiKey } from "./config-store.js";
import { loginViaBrowser } from "./browser-login.js";

export const DEFAULT_BROWSER_LOGIN_API_BASE_URL =
  "https://api.app.mrscraper.com/api/v1";

const EXCHANGE_TIMEOUT_MS = 30_000;

/** @param {unknown} value */
function cleanSecret(value) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/^bearer\s+/i, "")
        .trim()
    : "";
}

/** @param {unknown} value */
function safeErrorCode(value) {
  if (typeof value !== "string") return "";
  const code = value.trim();
  return /^[a-z][a-z0-9_-]{0,63}$/i.test(code) ? code : "";
}

/** @param {string} value */
function validateApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MrScraper browser-login API URL must be a valid URL");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "MrScraper browser-login API URL must use HTTPS unless it targets a loopback host",
    );
  }
  return url.toString();
}

/** @param {unknown} payload */
function extractApiKey(payload) {
  if (!payload || typeof payload !== "object") return "";
  const body = payload;
  const data = body.data && typeof body.data === "object" ? body.data : null;
  const nested =
    data?.data && typeof data.data === "object" ? data.data : null;
  for (const candidate of [
    nested?.api_key,
    nested?.apiKey,
    nested?.token,
    data?.api_key,
    data?.apiKey,
    data?.token,
    body.api_key,
    body.apiKey,
    body.token,
  ]) {
    const apiKey = cleanSecret(candidate);
    if (apiKey) return apiKey;
  }
  return "";
}

/**
 * Exchange the short-lived browser code and its PKCE verifier for a dedicated
 * long-lived API key. This request intentionally does not use the public API
 * response helper because that helper redacts credential fields.
 *
 * @param {{code: string, codeVerifier: string}} credential
 * @param {{environment?: NodeJS.ProcessEnv, fetchFn?: typeof fetch, timeoutMs?: number}} [options]
 */
export async function exchangeBrowserLoginCode(credential, options = {}) {
  const code = String(credential?.code || "").trim();
  const codeVerifier = String(credential?.codeVerifier || "").trim();
  if (!code || !codeVerifier) {
    throw new Error("Browser login requires both a code and PKCE verifier");
  }

  const environment = options.environment || process.env;
  const apiBaseUrl = validateApiBaseUrl(
    environment.MRSCRAPER_API_BASE_URL ||
      environment.MRSCRAPER_API_URL ||
      DEFAULT_BROWSER_LOGIN_API_BASE_URL,
  );
  const exchangeUrl = new URL(
    "auth/cli/exchange",
    apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs || EXCHANGE_TIMEOUT_MS,
  );

  try {
    const response = await (options.fetchFn || globalThis.fetch)(exchangeUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code, codeVerifier }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const detail = safeErrorCode(payload?.error);
      throw new Error(
        `Browser login exchange failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const apiKey = extractApiKey(payload);
    if (!apiKey) {
      throw new Error("Browser login exchange did not return an API key");
    }
    return apiKey;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Browser login exchange timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Open the browser login, exchange its single-use PKCE code for an API key,
 * and persist that key through the shared atomic credential store.
 *
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   homeDirectory?: string,
 *   fetchFn?: typeof fetch,
 *   noOpen?: boolean,
 *   timeoutMs?: number,
 *   openBrowserFn?: (url: string) => boolean | Promise<boolean>,
 *   browserLoginFn?: typeof loginViaBrowser,
 *   exchangeCodeFn?: typeof exchangeBrowserLoginCode,
 *   log?: (message: string) => void,
 * }} [options]
 */
export async function loginWithBrowser(options = {}) {
  const environment = options.environment || process.env;
  const log = options.log || console.log;
  const browserLoginFn = options.browserLoginFn || loginViaBrowser;
  const exchangeCodeFn = options.exchangeCodeFn || exchangeBrowserLoginCode;
  const credential = await browserLoginFn({
    environment,
    timeoutMs: options.timeoutMs,
    noOpen:
      options.noOpen || Boolean(environment.MRSCRAPER_NO_BROWSER?.trim()),
    openBrowserFn: options.openBrowserFn,
    log,
  });
  const apiKey = await exchangeCodeFn(credential, {
    environment,
    fetchFn: options.fetchFn,
  });
  const file = saveApiKey(apiKey, {
    environment,
    homeDirectory: options.homeDirectory,
  });
  log(`Saved browser-login credentials to ${file}`);
  return {
    auth: { version: 1, auth_type: "api_key", api_key: apiKey },
    path: file,
  };
}

/** @param {string | {auth_type: string, api_key?: string}} credential */
export function buildAuthHeaders(credential) {
  const apiKey = cleanSecret(
    typeof credential === "string" ? credential : credential?.api_key,
  );
  if (
    !apiKey ||
    (credential &&
      typeof credential === "object" &&
      credential.auth_type !== "api_key")
  ) {
    throw new Error("API key is required");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "x-api-token": apiKey,
  };
}

/**
 * Resolve one API key using CLI precedence and run an authenticated operation.
 * @template T
 * @param {string | undefined} explicitToken
 * @param {(credential: {auth_type: 'api_key', api_key: string}) => Promise<T>} operation
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 */
export async function runWithAuth(explicitToken, operation, options = {}) {
  const environment = options.environment || process.env;
  const explicit = cleanSecret(explicitToken);
  const environmentKey = cleanSecret(
    environment.MRSCRAPER_API_KEY || environment.MRSCRAPER_API_TOKEN,
  );
  const stored = !explicit && !environmentKey ? loadAuth(options) : null;
  const apiKey = explicit || environmentKey || stored?.api_key;
  if (!apiKey) {
    throw new Error(
      "MrScraper authentication is required. Run `mrscraper login`, set MRSCRAPER_API_KEY, or pass --token.",
    );
  }
  return operation({ auth_type: "api_key", api_key: apiKey });
}

/** @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options] */
export function authStatus(options = {}) {
  const environment = options.environment || process.env;
  if (cleanSecret(environment.MRSCRAPER_API_KEY)) {
    return {
      authenticated: true,
      auth_type: "api_key",
      source: "MRSCRAPER_API_KEY",
    };
  }
  if (cleanSecret(environment.MRSCRAPER_API_TOKEN)) {
    return {
      authenticated: true,
      auth_type: "api_key",
      source: "MRSCRAPER_API_TOKEN",
    };
  }
  const auth = loadAuth(options);
  if (!auth) return { authenticated: false, path: authPath(options) };
  return {
    authenticated: true,
    auth_type: "api_key",
    path: authPath(options),
  };
}

/**
 * Remove local credentials. Browser-provisioned API keys remain remotely
 * active until the backend provides a self-revocation endpoint.
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 */
export async function logout(options = {}) {
  return { removed: clearAuth(options) };
}
