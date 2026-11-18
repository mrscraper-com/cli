import { buildAuthHeaders } from "./auth.js";

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
    .replace(/(authorization\s*:\s*bearer\s+)[^\s'"\\]+/gi, "$1[REDACTED]")
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
      [
        "id",
        "scraperId",
        "status",
        "type",
        "url",
        "runtime",
        "tokenUsage",
      ].some((marker) => Object.prototype.hasOwnProperty.call(value, marker));

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
 * @param {string} url
 * @param {Record<string, string | number | boolean | undefined | null>} [params]
 */
function withQuery(url, params) {
  if (!params || Object.keys(params).length === 0) return url;
  const parsedUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      parsedUrl.searchParams.set(key, String(value));
    }
  }
  return parsedUrl.toString();
}

/**
 * @param {string} method
 * @param {string} url
 * @param {{
 * headers?: Record<string, string>;
 * params?: Record<string, string | number | boolean | undefined | null>;
 * json?: Record<string, unknown>;
 * timeout?: number;
 * }} [opts]
 */
export async function request(method, url, opts = {}) {
  const {
    headers = {},
    params,
    json: jsonBody,
    timeout = DEFAULT_TIMEOUT,
  } = opts;

  const fullUrl = withQuery(url, params);

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
    ).toLowerCase();
    const body = await response.text();

    let data = body;
    if (contentType.includes("application/json")) {
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = body;
      }
    }
    // Preserve non-JSON bodies exactly. In particular, fetched HTML must not be
    // rewritten because it happens to contain a token-looking string.
    if (contentType.includes("application/json")) {
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
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const aborted =
      exception?.name === "AbortError" || /abort(?:ed)?/i.test(message);
    return {
      error: aborted
        ? `Request timed out after ${timeoutSeconds}s`
        : redactSensitiveString(message),
      status_code: null,
      data: null,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drop null and undefined values so omitted options stay off the wire.
 * @param {Record<string, unknown>} values
 */
function compact(values) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

// The Scraper API refuses request URLs over about 8 KB with 414.
const MAX_GET_URL_LENGTH = 8000;
const TRANSPORT_GRACE_SECONDS = 30;
const WAIT_UNTIL_EVENTS = [
  "domcontentloaded",
  "load",
  "networkidle0",
  "networkidle2",
];
export const DEFAULT_JSON_PROMPT = "Extract all data as complete as possible.";

/**
 * Options shared by the page commands. Unlisted Scraper API fields, such as
 * `tokenCap`, `record`, and `action`, are never sent.
 * @typedef {object} PageOptions
 * @property {string | object} token API key or saved credential.
 * @property {string} url Absolute HTTP or HTTPS page URL.
 * @property {boolean} [superMode=false] Route through real devices.
 * @property {'domcontentloaded' | 'load' | 'networkidle0' | 'networkidle2'} [waitUntil='domcontentloaded']
 * @property {number} [timeout=300] Page timeout in seconds (1–300).
 * @property {string} [geoCode='us'] Two-letter country to load the page from.
 * @property {string} [proxyCountry='us'] Two-letter proxy server country.
 * @property {string} [proxy] Custom proxy URL.
 * @property {number} [maxRetries] Nonnegative retry limit; omit for no limit.
 * @property {boolean} [saveResult=false] Save the result to the dashboard.
 */

/**
 * @typedef {object} LoadingOptions
 * @property {boolean} [blockResources=false] Block images, fonts, and stylesheets.
 * @property {string} [waitForSelector] CSS selector to wait for.
 * @property {boolean} [returnCookie=false] Include browser session cookies.
 */

/** @param {PageOptions} options */
function pageParams({
  url,
  superMode = false,
  waitUntil = "domcontentloaded",
  timeout = 300,
  geoCode = "us",
  proxyCountry = "us",
  proxy,
  maxRetries,
  saveResult = false,
}) {
  requirePageUrl(url);
  requireChoice("wait until", waitUntil, WAIT_UNTIL_EVENTS);
  requireInteger("timeout", timeout, 1, 300);
  if (maxRetries != null) requireInteger("max retries", maxRetries, 0);
  return compact({
    url,
    super: superMode,
    waitUntil,
    timeout,
    geoCode: requireCountry("geo code", geoCode),
    proxyCountry: requireCountry("proxy country", proxyCountry),
    proxy: optionalText("proxy", proxy),
    maxRetries,
    saveResult,
  });
}

/** @param {LoadingOptions} options */
function loadingParams({
  blockResources = false,
  waitForSelector,
  returnCookie = false,
}) {
  return compact({
    blockResources,
    waitForSelector: optionalText("wait for selector", waitForSelector),
    returnCookie,
  });
}

function requirePageUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    /* Report a consistent validation error. */
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must be an absolute HTTP or HTTPS URL");
  }
}

function requireInteger(
  label,
  value,
  minimum,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
}

function requireChoice(label, value, choices) {
  if (!choices.includes(value))
    throw new Error(`${label} must be one of: ${choices.join(", ")}`);
}

function requireText(label, value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalText(label, value) {
  return value == null ? undefined : requireText(label, value);
}

function requireCountry(label, value) {
  if (typeof value !== "string" || !/^[a-z]{2}$/i.test(value))
    throw new Error(`${label} must be a two-letter country code`);
  return value.toLowerCase();
}

function scraperGet(token, params, timeout) {
  return request("GET", SCRAPER_API_BASE_URL, {
    headers: getAuthHeaders(token),
    params,
    timeout,
  });
}

function scrapePage(token, params) {
  return scraperGet(token, params, params.timeout + TRANSPORT_GRACE_SECONDS);
}

/** Retrieve a page as raw HTML.
 * @param {PageOptions & LoadingOptions & { browserRendering?: boolean }} options
 */
export async function scrapeHtml({ browserRendering = false, ...options }) {
  return scrapePage(options.token, {
    ...pageParams(options),
    ...loadingParams(options),
    browserRendering,
    html: true,
    markdown: false,
    screenshot: false,
  });
}

/** Retrieve a page as Markdown. With `html`, the page is rendered in a browser
 * and the response is JSON holding both.
 * @param {PageOptions & LoadingOptions & { browserRendering?: boolean, html?: boolean }} options
 */
export async function scrapeMarkdown({
  browserRendering = false,
  html = false,
  ...options
}) {
  return scrapePage(options.token, {
    ...pageParams(options),
    ...loadingParams(options),
    // The API fails with HTTP 500 for html+markdown without browser rendering.
    browserRendering: html || browserRendering,
    html,
    markdown: true,
    screenshot: false,
  });
}

/** Capture a base64 screenshot of the full page or the top viewport.
 * Browser rendering is always on.
 * @param {PageOptions & LoadingOptions & { screenshot?: 'full' | 'top', html?: boolean, markdown?: boolean }} options
 */
export async function getScreenshot({
  screenshot = "full",
  html = true,
  markdown = false,
  ...options
}) {
  requireChoice("screenshot", screenshot, ["full", "top"]);
  return scrapePage(options.token, {
    ...pageParams(options),
    ...loadingParams(options),
    browserRendering: true,
    screenshot,
    html,
    markdown,
  });
}

/** Extract structured JSON with the `general` agent. Sent as GET; a prompt
 * too long for the URL is sent with the documented POST body instead.
 * @param {PageOptions & { prompt?: string, browserRendering?: boolean, html?: boolean, screenshot?: boolean }} options
 */
export async function scrapeJson({
  prompt = DEFAULT_JSON_PROMPT,
  browserRendering = false,
  html = false,
  screenshot = false,
  ...options
}) {
  requireText("prompt", prompt);
  const params = {
    ...pageParams(options),
    browserRendering,
    html,
    screenshot,
    agent: "general",
  };
  const headers = getAuthHeaders(options.token);
  const timeout = params.timeout + TRANSPORT_GRACE_SECONDS;
  const getUrl = withQuery(SCRAPER_API_BASE_URL, { ...params, prompt });
  if (getUrl.length <= MAX_GET_URL_LENGTH) {
    return request("GET", getUrl, { headers, timeout });
  }
  const { url, agent, ...query } = params;
  return request("POST", SCRAPER_API_BASE_URL, {
    headers,
    params: query,
    json: { url, prompt, agent },
    timeout,
  });
}

/** Extract a website's brand as JSON (`bundle=none`).
 * @param {{ token: string | object, url: string }} options
 */
export async function scrapeBrand({ token, url }) {
  requirePageUrl(url);
  return scraperGet(token, { action: "brand-scraping", url, bundle: "none" });
}

/** Search the web and return ranked results.
 * @param {{ token: string | object, query: string, country?: string, numResults?: number }} options
 */
export async function webSearch({
  token,
  query,
  country = "us",
  numResults = 10,
}) {
  const text = typeof query === "string" ? query.trim() : "";
  if (!text || [...text].length > 1000) {
    throw new Error("query must be 1 to 1000 characters");
  }
  requireInteger("num results", numResults, 10, 100);
  return scraperGet(token, {
    action: "websearch",
    query: text,
    country: requireCountry("country", country),
    numResults,
  });
}

/** @param {string} token */
export async function getSubscriptionAccountApi(token) {
  return request("GET", `${API_BASE_URL}/subscription-accounts`, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
  });
}
