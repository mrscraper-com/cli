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
 */
export async function request(method, url, opts = {}) {
  const {
    headers = {},
    params,
    json: jsonBody,
    timeout = DEFAULT_TIMEOUT,
    sanitizeData = true,
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
    if (sanitizeData && contentType.includes("application/json")) {
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
    // fetch reports every network failure as "fetch failed"; the cause says why.
    const cause = exception?.cause?.message || exception?.cause?.code;
    return {
      error: aborted
        ? `Request timed out after ${timeoutSeconds}s`
        : redactSensitiveString(cause ? `${message} (${cause})` : message),
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
// Web search has a fixed HTTP deadline; it is not a service parameter.
const SEARCH_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 330;
// The API's page timeout when the request leaves it out.
const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_SELECTOR_LENGTH = 500;
// Seven days, the oldest cached result the Scraper API serves.
const MAX_CACHE_AGE_MS = 604800000;
const SCREENSHOT_VIEWPORT = /^(\d{3,4})x(\d{3,4})(?:-(\d{2,3}))?$/;
export const DEFAULT_JSON_PROMPT = "Extract all data as complete as possible.";

/**
 * Options shared by the page commands. Only documented Scraper API fields are
 * sent; each command adds its fixed fields, such as `html=true`. Results are
 * always saved (`saveResult=true`) and `tokenCap` is never sent.
 * @typedef {object} PageOptions
 * @property {string | object} token API key used to authenticate the request.
 * @property {string} url Absolute HTTP or HTTPS URL of the page to process.
 * @property {number} [timeout=300] Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.
 * @property {string} [waitForSelector] CSS selector or text to wait for on the page before returning the result, up to 500 characters.
 * @property {string} [geoCode] Two-letter country code to load the page from, sent in lowercase.
 * @property {number} [maxAge=0] Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape.
 * @property {number} [maxRetries] Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.
 */

/**
 * Loading controls accepted by HTML, Markdown, and JSON extraction.
 * @typedef {object} LoadingOptions
 * @property {boolean} [browserRendering] Whether to load the page in a browser: true always does and false never does. Omit it to load the page without a browser first and switch to a browser automatically if the request is blocked.
 * @property {boolean} [warmStart=false] Whether to open the site's home page first to warm the session before loading the target URL.
 * @property {boolean} [blockResources=false] Whether to block images, fonts, and stylesheets while loading the page.
 */

/**
 * Validate the page controls shared by every page command.
 * @param {PageOptions} options
 */
function pageParams({
  url,
  timeout = 300,
  waitForSelector,
  geoCode,
  maxAge = 0,
  maxRetries,
}) {
  requirePageUrl(url);
  requireInteger("timeout", timeout, 1, MAX_TIMEOUT_SECONDS);
  requireInteger("max age", maxAge, 0, MAX_CACHE_AGE_MS);
  if (maxRetries != null) requireInteger("max retries", maxRetries, 0);
  return {
    url,
    timeout,
    waitForSelector: optionalSelector(waitForSelector),
    geoCode: geoCode == null ? undefined : requireCountry("geo code", geoCode),
    maxAge,
    maxRetries: maxRetries ?? undefined,
  };
}

/** @param {LoadingOptions} options */
function loadingParams({
  browserRendering,
  warmStart = false,
  blockResources = false,
}) {
  if (browserRendering != null)
    requireBoolean("browserRendering", browserRendering);
  requireBoolean("warmStart", warmStart);
  requireBoolean("blockResources", blockResources);
  return {
    browserRendering: browserRendering ?? undefined,
    warmStart,
    blockResources,
  };
}

/**
 * Return the shared page and loading fields in the documented request order.
 * @param {ReturnType<typeof pageParams>} page
 * @param {Partial<ReturnType<typeof loadingParams>>} [loading]
 * @param {string} [action]
 */
function sharedFields(page, loading = {}, action) {
  return {
    browserRendering: loading.browserRendering,
    timeout: page.timeout,
    warmStart: loading.warmStart,
    blockResources: loading.blockResources,
    waitForSelector: page.waitForSelector,
    action,
    geoCode: page.geoCode,
    // Results are always saved to the dashboard; saveResult is not an option.
    saveResult: true,
    maxAge: page.maxAge,
    maxRetries: page.maxRetries,
  };
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

function requireBoolean(label, value) {
  if (typeof value !== "boolean")
    throw new TypeError(`${label} must be a boolean`);
}

function requireText(label, value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalText(label, value) {
  return value == null ? undefined : requireText(label, value);
}

function optionalSelector(value) {
  const selector = optionalText("wait for selector", value);
  if (selector !== undefined && [...selector].length > MAX_SELECTOR_LENGTH) {
    throw new Error(
      `wait for selector must be at most ${MAX_SELECTOR_LENGTH} characters`,
    );
  }
  return selector;
}

function requireCountry(label, value) {
  if (typeof value !== "string" || !/^[a-z]{2}$/i.test(value))
    throw new Error(`${label} must be a two-letter country code`);
  return value.toLowerCase();
}

/**
 * Accept false, full, top, or a WIDTHxHEIGHT viewport with an optional -ZOOM.
 * @param {false | string} value
 */
function screenshotCapture(value) {
  if (value === false || value === "full" || value === "top") return value;
  const match = typeof value === "string" && SCREENSHOT_VIEWPORT.exec(value);
  if (match) {
    const [width, height] = [Number(match[1]), Number(match[2])];
    const zoom = match[3] === undefined ? 100 : Number(match[3]);
    if (
      width >= 100 &&
      width <= 3840 &&
      height >= 100 &&
      height <= 3840 &&
      zoom >= 25 &&
      zoom <= 300
    ) {
      return value;
    }
  }
  throw new Error(
    "screenshot must be false, full, top, or WIDTHxHEIGHT from 100 to 3840 pixels with an optional -ZOOM from 25 to 300, such as 1280x800 or 1920x1080-75",
  );
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

/** Retrieve the raw HTML of a page. Browser rendering is optional.
 * @param {PageOptions & LoadingOptions & { action?: string, screenshot?: false | string }} options
 */
export async function scrapeHtml({ action, screenshot = false, ...options }) {
  const page = pageParams(options);
  const loading = loadingParams(options);
  const capture = screenshotCapture(screenshot);
  // A screenshot needs a rendered page, so it always sends browserRendering=true.
  if (capture !== false) loading.browserRendering = true;
  return scrapePage(
    options.token,
    compact({
      url: page.url,
      html: true,
      markdown: false,
      ...sharedFields(page, loading, optionalText("action", action)),
      screenshot: capture,
    }),
  );
}

/** Retrieve a page as clean Markdown. Browser rendering is optional.
 * @param {PageOptions & LoadingOptions & { action?: string }} options
 */
export async function scrapeMarkdown({ action, ...options }) {
  const page = pageParams(options);
  const loading = loadingParams(options);
  return scrapePage(
    options.token,
    compact({
      url: page.url,
      markdown: true,
      html: false,
      screenshot: false,
      ...sharedFields(page, loading, optionalText("action", action)),
    }),
  );
}

/** Capture a base64 PNG screenshot of the full page. Browser rendering is always enabled.
 * @param {PageOptions} options
 */
export async function getScreenshot(options) {
  const page = pageParams(options);
  return scrapePage(
    options.token,
    compact({
      url: page.url,
      screenshot: "full",
      html: false,
      markdown: false,
      ...sharedFields(page, { browserRendering: true }),
    }),
  );
}

/** Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.
 * @param {PageOptions & LoadingOptions & { prompt?: string, html?: boolean, screenshot?: boolean }} options
 */
export async function scrapeJson({
  prompt = DEFAULT_JSON_PROMPT,
  html = true,
  screenshot = false,
  ...options
}) {
  requireText("prompt", prompt);
  requireBoolean("html", html);
  requireBoolean("screenshot", screenshot);
  const page = pageParams(options);
  const loading = loadingParams(options);
  const params = compact({
    url: page.url,
    prompt,
    agent: "general",
    html,
    ...sharedFields(page, loading),
    screenshot,
  });
  const headers = getAuthHeaders(options.token);
  const timeout = params.timeout + TRANSPORT_GRACE_SECONDS;
  const getUrl = withQuery(SCRAPER_API_BASE_URL, params);
  if (getUrl.length <= MAX_GET_URL_LENGTH) {
    return request("GET", getUrl, { headers, timeout });
  }
  const { url, prompt: instructions, agent, ...query } = params;
  return request("POST", SCRAPER_API_BASE_URL, {
    headers,
    params: query,
    json: { url, prompt: instructions, agent },
    timeout,
  });
}

/** Extract a website's colors, typography, logos, and social links as JSON.
 * @param {{ token: string | object, url: string, timeout?: number, warmStart?: boolean, geoCode?: string }} options
 */
export async function scrapeBrand({
  token,
  url,
  timeout,
  warmStart = false,
  geoCode,
}) {
  requirePageUrl(url);
  if (timeout != null)
    requireInteger("timeout", timeout, 1, MAX_TIMEOUT_SECONDS);
  requireBoolean("warmStart", warmStart);
  return scraperGet(
    token,
    compact({
      action: "brand-scraping",
      url,
      bundle: "none",
      // timeout and geoCode are sent only when set.
      timeout: timeout ?? undefined,
      warmStart,
      geoCode:
        geoCode == null ? undefined : requireCountry("geo code", geoCode),
    }),
    (timeout ?? DEFAULT_TIMEOUT_SECONDS) + TRANSPORT_GRACE_SECONDS,
  );
}

/** Search the web and return ranked results with titles, URLs, descriptions, and sources.
 * @param {{ token: string | object, query: string, country?: string, numResults?: number }} options
 */
export async function webSearch({ token, query, country, numResults = 10 }) {
  const text = typeof query === "string" ? query.trim() : "";
  if (!text || [...text].length > 1000) {
    throw new Error("query must be 1 to 1000 characters");
  }
  requireInteger("num results", numResults, 10, 100);
  return scraperGet(
    token,
    compact({
      action: "websearch",
      query: text,
      country: country == null ? undefined : requireCountry("country", country),
      numResults,
    }),
    SEARCH_TIMEOUT_SECONDS,
  );
}

/** Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.
 * @param {string} token API key used to authenticate the request.
 */
export async function getSubscriptionAccountApi(token) {
  return request("GET", `${API_BASE_URL}/subscription-accounts`, {
    sanitizeData: false,
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
  });
}
