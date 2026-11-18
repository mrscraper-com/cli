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
    ).toLowerCase();
    const binary =
      contentType.startsWith("image/") ||
      /application\/(?:zip|x-zip-compressed|octet-stream)/.test(contentType);
    const body = binary
      ? {
          encoding: "base64",
          content_type: contentType,
          base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
        }
      : await response.text();

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

/**
 * @typedef {object} PageOptions
 * @property {string | object} token API key or saved credential.
 * @property {string} url Absolute HTTP or HTTPS page URL.
 * @property {number} [timeout=300] Page timeout in seconds (1–300).
 * @property {boolean} [superMode] Real-device routing; omit for the API default.
 * @property {boolean | null} [browserRendering] Chromium rendering.
 * @property {'domcontentloaded' | 'load' | 'networkidle0' | 'networkidle2'} [waitUntil]
 * @property {boolean} [blockResources]
 * @property {string} [waitForSelector] CSS selector to wait for.
 * @property {boolean} [returnCookie]
 * @property {string} [geoCode]
 * @property {string} [proxyCountry]
 * @property {string} [proxy] Custom proxy URL.
 * @property {boolean} [saveResult]
 * @property {number} [maxRetries] Nonnegative retry limit.
 * @property {number} [tokenCap] Positive total token budget.
 */

/** Validate shared page-loading options before sending a request.
 * @param {PageOptions} options
 */
function pageParams(options) {
  const { url, timeout = 300, maxRetries, tokenCap, waitUntil } = options;
  requirePageUrl(url);
  requireInteger("timeout", timeout, 1, 300);
  if (maxRetries != null) requireInteger("max retries", maxRetries, 0);
  if (tokenCap != null) requireInteger("token cap", tokenCap, 1);
  if (waitUntil != null)
    requireChoice("wait until", waitUntil, [
      "domcontentloaded",
      "load",
      "networkidle0",
      "networkidle2",
    ]);
  return compact({
    token: getAuthHeaders(options.token)["x-api-token"],
    url,
    timeout,
    super: options.superMode,
    browserRendering: options.browserRendering,
    waitUntil,
    blockResources: options.blockResources,
    waitForSelector: options.waitForSelector,
    returnCookie: options.returnCookie,
    geoCode: options.geoCode,
    proxyCountry: options.proxyCountry,
    proxy: options.proxy,
    saveResult: options.saveResult,
    maxRetries,
    tokenCap,
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

function scrapePage(options, representation) {
  const params = { ...pageParams(options), ...representation };
  return request("GET", SCRAPER_API_BASE_URL, {
    headers: getAuthHeaders(options.token),
    params,
    timeout: params.timeout + 30,
  });
}

/** Retrieve a page as raw HTML.
 * @param {PageOptions} options
 */
export async function scrapeHtml(options) {
  return scrapePage(options, { html: true });
}

/** Retrieve a page as clean Markdown.
 * @param {PageOptions} options
 */
export async function scrapeMarkdown(options) {
  return scrapePage(options, { html: false, markdown: true });
}

/** Capture the full page (default) or the top viewport as a base64 screenshot.
 * @param {PageOptions & { area?: 'full' | 'top', html?: boolean, markdown?: boolean }} options
 */
export async function getScreenshot({
  area = "full",
  html = true,
  markdown = false,
  ...options
}) {
  requireChoice("area", area, ["full", "top"]);
  return scrapePage(options, {
    screenshot: area,
    browserRendering: true,
    html,
    markdown,
  });
}

/** Extract structured JSON. POST keeps long prompts out of the request URL.
 * @param {PageOptions & { prompt?: string, html?: boolean, screenshot?: boolean }} options
 */
export async function scrapeJson({
  prompt = "Extract all data as complete as possible.",
  html = true,
  screenshot,
  ...options
}) {
  requireText("prompt", prompt);
  const params = pageParams(options);
  delete params.url;
  return request("POST", SCRAPER_API_BASE_URL, {
    headers: getAuthHeaders(options.token),
    params: compact({ ...params, html, screenshot }),
    json: { url: options.url, prompt, agent: "general" },
    timeout: params.timeout + 30,
  });
}

/** Scrape a brand and wait for its job to settle. */
export async function scrapeBrand({
  token,
  url,
  bundle = "none",
  timeout = 300,
}) {
  requirePageUrl(url);
  requireChoice("bundle", bundle, ["none", "clean", "full"]);
  requireInteger("timeout", timeout, 1);
  return request("POST", SCRAPER_API_BASE_URL, {
    headers: getAuthHeaders(token),
    params: { action: "brand-scraping", url, bundle },
    json: { url },
    timeout,
  });
}

/** Read an existing brand job or one of its artifacts. Binary data is base64 encoded. */
export async function getBrand({ token, jobId, output, timeout = 300 }) {
  const id = requireText("job ID", jobId);
  if (output != null)
    requireChoice("output", output, [
      "html",
      "bundle",
      "screenshot",
      "screenshot_full",
    ]);
  requireInteger("timeout", timeout, 1);
  return request(
    "GET",
    `${SCRAPER_API_BASE_URL.replace(/\/$/, "")}/neo/brand`,
    {
      headers: getAuthHeaders(token),
      params: compact({ id, output }),
      timeout,
    },
  );
}

/** Search the web using the unified Scraper API. Timeout is local only. */
export async function webSearch({
  token,
  query,
  country = "us",
  numResults = 10,
  timeout = 600,
}) {
  const searchQuery = requireText("query", query);
  if (typeof country !== "string" || !/^[a-z]{2}$/i.test(country)) {
    throw new Error("country must be a two-letter country code");
  }
  requireInteger("num results", numResults, 10, 100);
  requireInteger("timeout", timeout, 1);
  return request("POST", SCRAPER_API_BASE_URL, {
    headers: getAuthHeaders(token),
    json: {
      action: "websearch",
      query: searchQuery,
      country: country.toLowerCase(),
      numResults,
    },
    timeout,
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
