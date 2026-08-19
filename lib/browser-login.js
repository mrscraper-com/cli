import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const CALLBACK_PATH = "/callback";
export const DEFAULT_BROWSER_LOGIN_TIMEOUT_MS = 180_000;
export const DEFAULT_APP_BASE_URL = "https://app.mrscraper.com";

export class BrowserLoginError extends Error {
  /**
   * @param {"port" | "timeout" | "denied" | "cancelled"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "BrowserLoginError";
    this.code = code;
  }
}

/**
 * All bodies are static and never reflect the callback query string.
 */
function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><script>history.replaceState(null, "", location.pathname)</script><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#222}main{text-align:center;max-width:32rem}h1{font-size:1.4rem}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const PAGES = {
  success: htmlPage(
    "MrScraper authorization received",
    "Return to the terminal while the CLI completes login.",
  ),
  denied: htmlPage(
    "Login cancelled",
    "The login was cancelled in the browser. Return to the terminal.",
  ),
  badState: htmlPage(
    "State mismatch",
    "This request did not match the login in progress — possible forged request. Return to the terminal and try again.",
  ),
  noCode: htmlPage(
    "No login code received",
    "The callback did not include a code in the query string. Return to the terminal and retry.",
  ),
  done: htmlPage(
    "Login already completed",
    "You can close this tab.",
  ),
  notFound: htmlPage("Not found", "Return to the terminal."),
};

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} body
 */
function respond(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Connection: "close",
  });
  res.end(body);
}

/** @param {string} a @param {string} b */
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Open a URL in the default browser without ever passing secrets.
 * @param {string} url
 * @param {{platform?: NodeJS.Platform, spawnFn?: typeof spawn}} [options]
 * @returns {Promise<boolean>} true if the browser launch appears to have worked
 */
export function openBrowser(url, options = {}) {
  return new Promise((resolve) => {
    const platform = options.platform || process.platform;
    const spawnFn = options.spawnFn || spawn;
    let cmd;
    let args;
    if (platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (platform === "win32") {
      cmd = "rundll32.exe";
      args = ["url.dll,FileProtocolHandler", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }
    let settled = false;
    /** @param {boolean} ok */
    const settle = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const child = spawnFn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => settle(false));
      child.on("exit", (code) => settle(code === 0));
      child.unref();
      // `open`/`start` normally exit immediately; if the launcher lingers,
      // assume it worked rather than blocking the login flow.
      setTimeout(() => settle(true), 2000).unref?.();
    } catch {
      settle(false);
    }
  });
}

/**
 * PKCE pair: the verifier stays in the CLI; only the S256 challenge goes
 * into the login URL. The token can then only be obtained by exchanging
 * the single-use callback code together with the verifier.
 * @returns {{ verifier: string, challenge: string }}
 */
export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * @param {string} appBaseUrl
 * @param {number} port
 * @param {string} state
 * @param {string} codeChallenge
 * @returns {string}
 */
export function buildLoginUrl(appBaseUrl, port, state, codeChallenge) {
  const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const u = new URL("/auth/login", appBaseUrl);
  u.searchParams.set("cli_redirect", redirect);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** @param {string} value */
function validateAppBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MrScraper app URL must be a valid URL");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "MrScraper app URL must use HTTPS unless it targets a loopback host",
    );
  }
  return url.toString();
}

/**
 * Run the loopback browser-login flow and return the single-use code with its
 * local PKCE verifier. API keys are never accepted through the callback URL.
 * @param {{
 *   appBaseUrl?: string,
 *   environment?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   noOpen?: boolean,
 *   openBrowserFn?: (url: string) => boolean | Promise<boolean>,
 *   log?: (msg: string) => void,
 * }} [options]
 * @returns {Promise<{ code: string, codeVerifier: string }>}
 */
export function loginViaBrowser(options = {}) {
  const environment = options.environment || process.env;
  const appBaseUrl = validateAppBaseUrl(
    options.appBaseUrl || environment.MRSCRAPER_APP_URL || DEFAULT_APP_BASE_URL,
  );
  const timeoutMs = options.timeoutMs || DEFAULT_BROWSER_LOGIN_TIMEOUT_MS;
  const log = options.log || ((message) => console.error(message));
  const openBrowserFn = options.openBrowserFn || openBrowser;
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString("hex");
    const pkce = createPkcePair();
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {Set<import("node:net").Socket>} */
    const sockets = new Set();

    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== CALLBACK_PATH) {
        respond(res, 404, PAGES.notFound);
        return;
      }
      if (req.method !== "GET") {
        respond(res, 405, PAGES.notFound);
        return;
      }
      if (settled) {
        respond(res, 410, PAGES.done);
        return;
      }
      const gotState = u.searchParams.get("state") ?? "";
      if (!timingSafeEqualStr(gotState, state)) {
        // Do not settle: a stray/forged request must not kill the real login.
        log("Ignored a callback with a mismatched state parameter.");
        respond(res, 400, PAGES.badState);
        return;
      }
      if (u.searchParams.get("error")) {
        respond(res, 200, PAGES.denied);
        settle(() => reject(new BrowserLoginError("denied", "Login was cancelled in the browser.")));
        return;
      }
      const code = (u.searchParams.get("code") ?? "").trim();
      if (!code) {
        respond(res, 400, PAGES.noCode);
        return;
      }
      respond(res, 200, PAGES.success);
      settle(() => resolve({ code, codeVerifier: pkce.verifier }));
    });

    const onSigint = () => {
      settle(() => reject(new BrowserLoginError("cancelled", "Login cancelled.")));
    };

    function cleanup() {
      if (timer) clearTimeout(timer);
      process.removeListener("SIGINT", onSigint);
      server.close();
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      } else {
        for (const socket of sockets) socket.destroy();
      }
    }

    /** @param {() => void} finish */
    function settle(finish) {
      if (settled) return;
      settled = true;
      // Let the in-flight response flush before tearing sockets down.
      setImmediate(() => {
        cleanup();
        finish();
      });
    }

    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });

    server.on("error", (err) => {
      settle(() =>
        reject(
          new BrowserLoginError(
            "port",
            `Could not start the local callback server: ${err.message}`,
          ),
        ),
      );
    });

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const url = buildLoginUrl(appBaseUrl, port, state, pkce.challenge);
      log(
        options.noOpen
          ? `Open this URL to log in:\n${url}`
          : `Opening your browser to log in. If it doesn't open, visit:\n${url}`,
      );
      timer = setTimeout(() => {
        settle(() =>
          reject(
            new BrowserLoginError(
              "timeout",
              `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser login.`,
            ),
          ),
        );
      }, timeoutMs);
      process.once("SIGINT", onSigint);
      if (!options.noOpen) {
        const opened = await openBrowserFn(url);
        if (!opened) {
          log("Could not open a browser automatically — use the URL above.");
        }
      }
    });
  });
}
