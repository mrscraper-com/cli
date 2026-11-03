import { buildAuthHeaders } from "./auth.js";
import { summarizeSubscriptionAccount } from "./status.js";

const DEFAULT_TIMEOUT = 600;
const SENSITIVE_RESPONSE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "x-api-token",
]);
const SENSITIVE_DATA_KEYS = new Set([
  "accesstoken",
  "api_key",
  "apikey",
  "apitoken",
  "authorization",
  "cookie",
  "latestapitoken",
  "password",
  "refreshtoken",
  "secret",
  "set-cookie",
  "token",
  "x-api-token",
]);

export const API_BASE_URL =
  process.env.MRSCRAPER_API_BASE_URL || "https://api.app.mrscraper.com/api/v1";
export const SCRAPER_API_BASE_URL =
  process.env.MRSCRAPER_FETCH_BASE_URL || "https://api.mrscraper.com";

function getAuthHeaders(token) {
  return buildAuthHeaders(token);
}

/** @param {string} value */
function redactSensitiveString(value) {
  return value
    .replace(/\batk_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_TOKEN]")
    .replace(
      /(authorization\s*:\s*bearer\s+)[^\s'"\\]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(x-api-token\s*:\s*)[^\s'"\\]+/gi, "$1[REDACTED]")
    .replace(
      /([?&](?:token|api[_-]?key|signature|sig|x-amz-(?:credential|security-token|signature))=)[^&\s'"\\]+/gi,
      "$1[REDACTED]",
    );
}

/**
 * Redact known credential metadata without modifying a scraper run's extracted
 * `data` value. Generated curl commands are scrubbed separately.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function sanitizeResponseData(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseData(item, seen));
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isExtractedPayload =
      normalizedKey === "data" &&
      Object.prototype.hasOwnProperty.call(value, "data") &&
      ["id", "scraperId", "status", "type", "url", "runtime", "tokenUsage"].some(
        (marker) => Object.prototype.hasOwnProperty.call(value, marker),
      );

    if (isExtractedPayload) {
      // `data` on a scraper run is user-requested extraction output. It must
      // remain byte-for-byte equivalent to the parsed backend JSON value.
      sanitized[key] = item;
    } else if (SENSITIVE_DATA_KEYS.has(normalizedKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (normalizedKey === "curl" && typeof item === "string") {
      sanitized[key] = redactSensitiveString(item);
    } else {
      sanitized[key] = sanitizeResponseData(item, seen);
    }
  }
  return sanitized;
}

/**
 * @param {string} method
 * @param {string} url
 * @param {{
 * headers?: Record<string, string>;
 * params?: Record<string, string | number | boolean | undefined | null>;
 * json?: Record<string, unknown>;
 * timeout?: number;
 * preserveData?: boolean;
 * }} [opts]
 */
export async function request(method, url, opts = {}) {
  const {
    headers = {},
    params,
    json: jsonBody,
    timeout = DEFAULT_TIMEOUT,
    preserveData = false,
  } = opts;

  let fullUrl = url;
  if (params && Object.keys(params).length > 0) {
    const parsedUrl = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        parsedUrl.searchParams.set(key, String(value));
      }
    }
    fullUrl = parsedUrl.toString();
  }

  const controller = new AbortController();
  const parsedTimeout = Number(timeout);
  const timeoutSeconds =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_TIMEOUT;
  const timeoutMs = Math.max(1, Math.ceil(timeoutSeconds * 1000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = {
    method,
    headers: { ...headers },
    signal: controller.signal,
  };

  if (jsonBody !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.headers.accept = "application/json";
    init.body = JSON.stringify(jsonBody);
  }

  try {
    const response = await fetch(fullUrl, init);
    const contentType = (
      response.headers.get("content-type") || ""
    ).split(";", 1)[0].trim().toLowerCase();
    const jsonContent = contentType === "application/json" || contentType.endsWith("+json");
    const textContent = !contentType || contentType.startsWith("text/") || ["application/xml", "application/xhtml+xml", "application/javascript"].includes(contentType);
    const binary = !jsonContent && !textContent;
    const body = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();

    let data = body;
    if (jsonContent) {
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = body;
      }
    }
    // Preserve non-JSON bodies exactly. In particular, fetched HTML must not be
    // rewritten because it happens to contain a token-looking string.
    if (jsonContent && !(preserveData && response.ok)) {
      data = sanitizeResponseData(data);
    }

    const headerObj = Object.fromEntries(
      [...response.headers.entries()].filter(
        ([name]) => !SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase()),
      ),
    );

    if (response.status === 401) {
      return {
        error:
          "Unauthorized or invalid token. Run `mrscraper login` or visit https://app.mrscraper.com.",
        status_code: response.status,
        data,
        headers: headerObj,
      };
    }

    if (!response.ok) {
      return {
        error: `HTTP ${response.status}`,
        status_code: response.status,
        data,
        headers: headerObj,
      };
    }

    return {
      status_code: response.status,
      data,
      headers: headerObj,
    };
  } catch (exception) {
    const message = exception instanceof Error ? exception.message : String(exception);
    const aborted =
      exception?.name === "AbortError" || /abort(?:ed)?/i.test(message);
    return {
      error: aborted ? `Request timed out after ${timeoutSeconds}s` : redactSensitiveString(message),
      status_code: null,
      data: null,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

const MIN_SEARCH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 100;

/**
 * Internal transport shared by `scraperAPI` and the private format-specific
 * helpers. Only selected output flags are sent. GET requests and brand jobs
 * carry the target URL and retry controls in the query string; other requests
 * carry them in a JSON body.
 */
async function scrape({
  token, url, timeout = 120, geoCode = "US", proxyCountry = null,
  blockResources = false, browserRendering = null, super: superMode = false,
  useProxy = true, proxy = null, waitForSelector = null, waitUntil = null,
  homePage = false, bypassProxy = false, cookieJar = null, headers: targetHeaders = null,
  maxRetries = 3, tokenCap = null, stream = null, discardTokenSecret = "",
}, { method = "POST", html = null, markdown = null, screenshot = null,
  prompt = null, agent = null, maxPages = null, maxDepth = null, limit = null,
  includePatterns = null, excludePatterns = null, action = null, bundle = null } = {}) {
  if (typeof url !== "string" || !url.trim()) throw new Error("url must be a non-empty string");
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300) {
    throw new Error("timeout must be between 1 and 300 seconds");
  }
  for (const [name, value, minimum] of [
    ["maxRetries", maxRetries, 0], ["tokenCap", tokenCap, 0],
    ["maxPages", maxPages, 1], ["maxDepth", maxDepth, 0], ["limit", limit, 1],
  ]) {
    if (value !== null && (!Number.isInteger(value) || value < minimum)) {
      throw new Error(`${name} must be an integer >= ${minimum}`);
    }
  }
  if (maxRetries === null) throw new Error("maxRetries must be an integer >= 0");
  if (typeof superMode !== "boolean") throw new Error("super must be a boolean");
  if (bundle !== null && !["clean", "full", "none"].includes(bundle)) {
    throw new Error("bundle must be clean, full, or none");
  }
  const headers = getAuthHeaders(token);
  if (discardTokenSecret) headers["x-discard-token-secret"] = discardTokenSecret;
  const queryRetries = method === "GET" || action === "brand-scraping";
  const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
  return request(method, SCRAPER_API_BASE_URL, {
    headers,
    params: {
      token: headers["x-api-token"], timeout, geoCode, proxyCountry,
      browserRendering: screenshot ? true : browserRendering,
      super: superMode ? true : null, useProxy: useProxy ? null : false,
      proxy, html, markdown, waitForSelector, waitUntil,
      warmStart: homePage ? true : null, screenshot: screenshot || null,
      blockResources: blockResources ? true : null,
      bypassProxy: bypassProxy ? true : null, cookieJar,
      headers: targetHeaders !== null && typeof targetHeaders === "object"
        ? JSON.stringify(targetHeaders) : targetHeaders,
      stream, url: queryRetries ? url : null,
      maxRetries: queryRetries ? maxRetries : null,
      tokenCap: queryRetries ? tokenCap : null, action, bundle,
    },
    json: method === "GET" ? undefined : compact({
      url, maxRetries: queryRetries ? null : maxRetries,
      tokenCap: queryRetries ? null : tokenCap, prompt, agent, maxPages,
      maxDepth, limit, includePatterns, excludePatterns,
    }),
    timeout: timeout + 30,
    preserveData: true,
  });
}

/**
 * Fetch a public web page as rendered HTML, Markdown, screenshot, or a
 * combination.
 *
 * Sends a GET request. The target URL, output flags, page options, and retry
 * controls are all sent as query parameters. HTML-only requests return the page
 * as a string; requests that include Markdown or a screenshot return an object
 * such as `{ html, markdown, screenshot }` (screenshot as base64).
 *
 * @param {object} options
 * @param {string | {auth_type: string, api_key?: string}} options.token
 * @param {string} options.url Target URL.
 * @param {boolean} [options.html] Return HTML (default true).
 * @param {boolean} [options.markdown] Return Markdown (default false).
 * @param {boolean} [options.screenshot] Return a screenshot and force browser rendering (default false).
 */
export async function scraperAPI({ html = true, markdown = false, screenshot = false, ...options }) {
  for (const [name, value] of [["html", html], ["markdown", markdown], ["screenshot", screenshot]]) {
    if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  }
  if (!html && !markdown && !screenshot) {
    throw new Error("At least one of html, markdown, or screenshot must be true");
  }
  return scrape(options, { method: "GET", html, markdown, screenshot: screenshot || null });
}

// The format-specific helpers below are internal. They are not CLI commands
// and are not re-exported from the package entry point (lib/index.js); they are
// exported from this module only so the test suite can exercise them.

/** @internal Fetch a public web page as HTML. */
export async function _scraperHtml(options) {
  return scrape(options, { html: true });
}

/** @internal Fetch a public web page as Markdown. */
export async function _scraperMarkdown(options) {
  return scrape(options, { markdown: true });
}

/** @internal Capture a public web page as a rendered screenshot; full-page by default. */
export async function _getScreenshot({ fullPage = true, ...options }) {
  if (typeof fullPage !== "boolean") throw new Error("fullPage must be a boolean");
  return scrape({ ...options, timeout: options.timeout ?? 300, waitUntil: options.waitUntil === undefined ? "domcontentloaded" : options.waitUntil }, {
    method: "GET", screenshot: fullPage ? "full" : true,
  });
}

/** @internal Extract structured page data with the general agent. */
export async function _scraperJson({ prompt = "Extract all data as complete as possible.", ...options }) {
  return scrape(options, { html: true, agent: "general", prompt });
}

/** @internal Extract listing entries across pages. */
export async function _scraperMultiplePage({ prompt = "Extract all entry data as complete as possible.", maxPages = 3, ...options }) {
  return scrape(options, { agent: "listing", prompt, maxPages });
}

/** @internal Discover URLs while preserving optional pattern strings verbatim. */
export async function _scraperSitemap({ maxDepth = 2, maxPages = 3, limit = 1000, includePatterns = null, excludePatterns = null, ...options }) {
  return scrape(options, { agent: "map", maxDepth, maxPages, limit, includePatterns, excludePatterns });
}

/** @internal Start a job to extract brand assets with a clean, full, or no bundle. */
export async function _scrapeBrand({ bundle = "clean", ...options }) {
  return scrape(options, { action: "brand-scraping", bundle });
}

/** @internal Read a brand job or download HTML, a ZIP bundle, or a screenshot. */
export async function _getBrand({ token, jobId, output = null, timeout = 600 }) {
  if (typeof jobId !== "string" || !jobId.trim()) throw new Error("jobId must be a non-empty string");
  if (output !== null && !["html", "bundle", "screenshot", "screenshot_full"].includes(output)) {
    throw new Error("output must be html, bundle, screenshot, or screenshot_full");
  }
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("timeout must be greater than 0 seconds");
  return request("GET", `${SCRAPER_API_BASE_URL.replace(/\/$/, "")}/neo/brand`, {
    headers: getAuthHeaders(token), params: { id: jobId, output }, timeout, preserveData: true,
  });
}

/** @param {string} token */
async function getSubscriptionAccountApi(token, { timeout = 30 } = {}) {
  return request("GET", `${API_BASE_URL}/subscription-accounts`, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
    timeout,
  });
}

/** Check account identity, subscription, and quota without exposing credentials. */
export async function account({ token, timeout = 30 }) {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("timeout must be greater than 0 seconds");
  }
  const response = await getSubscriptionAccountApi(token, { timeout });
  if (response.error || response.status_code >= 400) return response;
  const body = response.data;
  const details = body && typeof body === "object" && "data" in body ? body.data : body;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return { ...response, data: null, error: "Account response must contain an object" };
  }
  return { ...response, data: summarizeSubscriptionAccount(details) };
}

/**
 * Searches the web to retrieve real-time results, including relevant website
 * URLs, titles, descriptions, and related questions based on a given query.
 *
 * Sends `{ action: "websearch", query, country, numResults }` as a JSON POST
 * to the MrScraper API. `country` is omitted when unset so the service default
 * applies. The response data contains `success`, `message`, and `data`, a list
 * of results with `rank`, `title`, `url`, `description`, and `source`.
 *
 * @param {object} options
 * @param {string | {auth_type: string, api_key?: string}} options.token
 * @param {string} options.query The search query.
 * @param {string | null} [options.country] Country code such as `us`.
 * @param {number} [options.numResults] Integer from 10 to 100 (default 10).
 * @param {number} [options.timeout] Request deadline in seconds (default 600).
 */
export async function webSearch({
  token,
  query,
  country = null,
  numResults = MIN_SEARCH_RESULTS,
  timeout = 600,
}) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("A search query is required");
  }
  if (country !== null && country !== undefined && (typeof country !== "string" || !country.trim())) {
    throw new Error("country must be a non-empty string");
  }
  if (
    !Number.isInteger(numResults) ||
    numResults < MIN_SEARCH_RESULTS ||
    numResults > MAX_SEARCH_RESULTS
  ) {
    throw new Error(
      `numResults must be an integer from ${MIN_SEARCH_RESULTS} to ${MAX_SEARCH_RESULTS}`,
    );
  }
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("timeout must be greater than 0 seconds");
  }
  const payload = { action: "websearch", query: query.trim() };
  if (country !== null && country !== undefined) payload.country = country.trim();
  payload.numResults = numResults;

  return request("POST", SCRAPER_API_BASE_URL, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
    json: payload,
    timeout,
  });
}
