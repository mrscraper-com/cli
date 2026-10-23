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
export const SYNC_SCRAPER_BASE_URL =
  process.env.MRSCRAPER_SYNC_BASE_URL || "https://sync.scraper.mrscraper.com";

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

/** Internal transport shared by the format-specific operations. */
async function scraperAPI({
  token, url, timeout = 120, geoCode = "US", proxyCountry = null,
  blockResources = false, browserRendering = null, super: superMode = false,
  useProxy = true, proxy = null, waitForSelector = null, waitUntil = null,
  homePage = false, bypassProxy = false, cookieJar = null, headers: targetHeaders = null,
  maxRetries = 3, tokenCap = null, stream = null, discardTokenSecret = "",
}, { method = "POST", html = null, markdown = null, screenshot = null,
  prompt = null, agent = null, maxPages = null, maxDepth = null, limit = null,
  includePatterns = null, excludePatterns = null, action = null, bundle = null } = {}) {
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
      warmStart: homePage ? true : null, screenshot,
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

/** Fetch a public web page as HTML, with optional browser rendering. */
export async function scraperHtml(options) {
  return scraperAPI(options, { html: true });
}

/** Fetch a public web page as Markdown for reading and analysis. */
export async function scraperMarkdown(options) {
  return scraperAPI(options, { markdown: true });
}

/** Capture a public web page as a rendered screenshot; full-page by default. */
export async function getScreenshot({ fullPage = true, ...options }) {
  if (typeof fullPage !== "boolean") throw new Error("fullPage must be a boolean");
  return scraperAPI({ ...options, timeout: options.timeout ?? 300, waitUntil: options.waitUntil === undefined ? "domcontentloaded" : options.waitUntil }, {
    method: "GET", screenshot: fullPage ? "full" : true,
  });
}

/** Extract structured page data with the general agent. */
export async function scraperJson({ prompt = "Extract all data as complete as possible.", ...options }) {
  return scraperAPI(options, { html: true, agent: "general", prompt });
}

/** Extract listing entries across pages. */
export async function scraperMultiplePage({ prompt = "Extract all entry data as complete as possible.", maxPages = 3, ...options }) {
  return scraperAPI(options, { agent: "listing", prompt, maxPages });
}

/** Discover URLs while preserving optional pattern strings verbatim. */
export async function scraperSitemap({ maxDepth = 2, maxPages = 3, limit = 1000, includePatterns = null, excludePatterns = null, ...options }) {
  return scraperAPI(options, { agent: "map", maxDepth, maxPages, limit, includePatterns, excludePatterns });
}

/** Start a job to extract brand assets with a clean, full, or no bundle. */
export async function scrapeBrand({ bundle = "clean", ...options }) {
  return scraperAPI(options, { action: "brand-scraping", bundle });
}

/** Read a brand job or download HTML, a ZIP bundle, or a screenshot. */
export async function getBrand({ token, jobId, output = null, timeout = 600 }) {
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
 * Accept a keyword or a Google search URL and derive the v2 SERP request fields.
 * @param {string} input
 */
export function normalizeSerpInput(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("A Google search query or URL is required");
  if (!/^https?:\/\//i.test(value)) {
    return { query: value, region: null, language: null, page: null };
  }
  const parsed = new URL(value);
  const query = parsed.searchParams.get("q")?.trim();
  if (!query) throw new Error("Google search URL must contain a q parameter");
  const startValue = parsed.searchParams.get("start") || "0";
  const start = /^[+-]?\d+$/.test(startValue.trim()) ? Number(startValue) : 0;
  return {
    query,
    region: parsed.searchParams.get("gl") || null,
    language: parsed.searchParams.get("hl") || null,
    page: Number.isFinite(start) && start > 0 ? Math.floor(start / 10) + 1 : null,
  };
}

/**
 * Search the web for live results, including URLs, titles, descriptions,
 * and related questions when available for the query.
 * @param {object} options
 * @param {string} options.token
 * @param {string} [options.query]
 * @param {string} [options.url] Legacy input alias.
 * @param {string | null} [options.region]
 * @param {string | null} [options.language]
 * @param {number | null} [options.page]
 * @param {'json' | 'html'} [options.format]
 * @param {boolean} [options.renderJs]
 * @param {boolean} [options.raw] Defaults to true, matching the SDK's HTML response.
 * @param {number} [options.timeout]
 */
export async function webSearch({
  token,
  query,
  url,
  region = null,
  language = null,
  page = null,
  format = "json",
  renderJs = false,
  raw = true,
  timeout = 600,
}) {
  const normalized = normalizeSerpInput(query || url);
  const resolvedFormat = raw ? "html" : format;
  if (!["json", "html"].includes(resolvedFormat)) {
    throw new Error("SERP format must be json or html");
  }
  const payload = {
    query: normalized.query,
    format: resolvedFormat,
    renderJs: Boolean(renderJs),
  };
  const resolvedRegion = region || normalized.region;
  const resolvedLanguage = language || normalized.language;
  const resolvedPage = page || normalized.page;
  if (resolvedRegion) payload.region = resolvedRegion;
  if (resolvedLanguage) payload.language = resolvedLanguage;
  if (resolvedPage) payload.page = resolvedPage;

  return request(
    "POST",
    `${SYNC_SCRAPER_BASE_URL}/api/google/serp/v2/sync`,
    {
      headers: {
        accept: "application/json",
        ...getAuthHeaders(token),
      },
      json: payload,
      timeout,
    },
  );
}
