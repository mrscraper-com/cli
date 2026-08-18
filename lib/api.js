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
export const FETCH_HTML_BASE_URL =
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
    const message = exception instanceof Error ? exception.message : String(exception);
    const aborted =
      exception?.name === "AbortError" || /abort(?:ed)?/i.test(message);
    return {
      error: aborted ? `Request timed out after ${timeoutSeconds}s` : message,
      status_code: null,
      data: null,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the documented Web Unblocker endpoint once.
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.url
 * @param {number} [options.timeout]
 * @param {string | null} [options.geoCode]
 * @param {boolean} [options.browserRendering]
 * @param {string | null} [options.waitForSelector]
 * @param {boolean} [options.homePage]
 * @param {boolean} [options.blockResources]
 * @param {number} [options.maxRetries]
 * @param {number | null} [options.tokenCap]
 */
export async function fetchContentApi({
  token,
  url,
  timeout = 30,
  geoCode = null,
  browserRendering = false,
  waitForSelector = null,
  homePage = false,
  blockResources = false,
  maxRetries = 3,
  tokenCap = null,
}) {
  const headers = { ...getAuthHeaders(token) };
  const params = {
    url,
    timeout,
    geoCode,
    browserRendering,
    waitForSelector,
    homePage,
    blockResources,
    maxRetries,
    tokenCap,
  };

  return request("GET", FETCH_HTML_BASE_URL, {
    headers,
    params,
    timeout: timeout + 30,
  });
}

/**
 * Backward-compatible positional wrapper for programmatic consumers.
 * @param {string} token
 * @param {string} url
 * @param {number} [timeout]
 * @param {string | null} [geoCode]
 * @param {boolean} [blockResources]
 */
export async function fetchHtmlApi(
  token,
  url,
  timeout = 30,
  geoCode = null,
  blockResources = false,
) {
  return fetchContentApi({
    token,
    url,
    timeout,
    geoCode,
    blockResources,
  });
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.url
 * @param {string} options.message
 * @param {'general' | 'listing' | 'map'} [options.agent]
 * @param {string | null} [options.proxyCountry]
 * @param {number} [options.maxDepth]
 * @param {number} [options.maxPages]
 * @param {number} [options.limit]
 * @param {string} [options.includePatterns]
 * @param {string} [options.excludePatterns]
 */
export async function createAiScraperApi({
  token,
  url,
  message,
  agent = "general",
  proxyCountry = null,
  maxDepth,
  maxPages,
  limit,
  includePatterns,
  excludePatterns,
}) {
  if (!["general", "listing", "map"].includes(agent)) {
    throw new Error("agent must be general, listing, or map");
  }
  if ((agent === "general" || agent === "listing") && !message?.trim()) {
    throw new Error("An extraction message is required for general and listing agents");
  }
  if (agent === "map" && proxyCountry !== null && proxyCountry !== undefined) {
    throw new Error("The map agent does not accept proxyCountry");
  }

  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };

  let payload;
  if (agent === "general" || agent === "listing") {
    payload = { url, message, agent };
    if (proxyCountry !== null && proxyCountry !== undefined) {
      payload.proxyCountry = proxyCountry;
    }
    if (agent === "listing" && maxPages !== undefined) {
      payload.maxPages = maxPages;
    }
  } else {
    if (message) throw new Error("The map agent does not accept an extraction prompt");
    payload = { url, agent };
    if (maxDepth !== undefined) payload.maxDepth = maxDepth;
    if (maxPages !== undefined) payload.maxPages = maxPages;
    if (limit !== undefined) payload.limit = limit;
    if (includePatterns !== undefined) payload.includePatterns = includePatterns;
    if (excludePatterns !== undefined) payload.excludePatterns = excludePatterns;
  }

  return request("POST", `${API_BASE_URL}/scrapers-ai`, {
    headers,
    json: payload,
  });
}

/** @param {object} options */
export async function rerunAiScraperApi({
  token,
  scraperId,
  url,
  maxDepth = 2,
  maxPages = 50,
  limit = 1000,
  includePatterns = "",
  excludePatterns = "",
}) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  const payload = {
    scraperId,
    url,
    maxDepth,
    maxPages,
    limit,
    includePatterns,
    excludePatterns,
  };
  return request("POST", `${API_BASE_URL}/scrapers-ai-rerun`, {
    headers,
    json: payload,
  });
}

/** @param {object} options */
export async function bulkRerunAiScraperApi({ token, scraperId, urls }) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  return request("POST", `${API_BASE_URL}/scrapers-ai-rerun/bulk`, {
    headers,
    json: { scraperId, urls },
  });
}

/** @param {object} options */
export async function rerunManualScraperApi({ token, scraperId, url }) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  return request("POST", `${API_BASE_URL}/scrapers-manual-rerun`, {
    headers,
    json: { scraperId, url },
  });
}

/** @param {object} options */
export async function bulkRerunManualScraperApi({ token, scraperId, urls }) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  return request("POST", `${API_BASE_URL}/scrapers-manual-rerun/bulk`, {
    headers,
    json: { scraperId, urls },
  });
}

/** @param {object} options */
export async function getAllResultsApi({
  token,
  sortField = "updatedAt",
  sortOrder = "DESC",
  pageSize = 10,
  page = 1,
  search = null,
  dateRangeColumn = null,
  startAt = null,
  endAt = null,
}) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  const params = { sortField, sortOrder, pageSize, page };
  if (search) params.search = search;
  if (dateRangeColumn) params.dateRangeColumn = dateRangeColumn;
  if (startAt) params.startAt = startAt;
  if (endAt) params.endAt = endAt;

  return request("GET", `${API_BASE_URL}/results`, { headers, params });
}

/** @param {string} token @param {string} resultId */
export async function getResultByIdApi(token, resultId) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  return request("GET", `${API_BASE_URL}/results/${resultId}`, { headers });
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

/** @param {object} options */
export async function getAnalyticStatusesApi({
  token,
  domain,
  startDate,
  endDate,
  action = "",
  apiTokenName = "",
}) {
  return request("GET", `${API_BASE_URL}/analytic/statuses`, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
    params: { domain, startDate, endDate, action, apiTokenName },
  });
}

/**
 * Accept a keyword or a Google search URL and derive the v2 SERP request fields.
 * @param {string} input
 */
export function normalizeSerpInput(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("A Google search query or URL is required");

  try {
    const parsed = new URL(trimmed);
    const query = parsed.searchParams.get("q")?.trim();
    if (!query) throw new Error("Google search URL must contain a q parameter");
    const start = Number(parsed.searchParams.get("start") || 0);
    return {
      query,
      region: parsed.searchParams.get("gl") || null,
      language: parsed.searchParams.get("hl") || null,
      page: Number.isFinite(start) && start > 0 ? Math.floor(start / 10) + 1 : null,
    };
  } catch (exception) {
    if (/^https?:\/\//i.test(trimmed)) throw exception;
    return { query: trimmed, region: null, language: null, page: null };
  }
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} [options.query]
 * @param {string} [options.url] Legacy input alias.
 * @param {string | null} [options.region]
 * @param {string | null} [options.language]
 * @param {number | null} [options.page]
 * @param {'json' | 'html'} [options.format]
 * @param {boolean} [options.renderJs]
 * @param {boolean} [options.raw] Legacy alias for format=html.
 * @param {number} [options.timeout]
 */
export async function googleSerpSyncApi({
  token,
  query,
  url,
  region = null,
  language = null,
  page = null,
  format = "json",
  renderJs = false,
  raw = false,
  timeout = 120,
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

/** @param {string} raw */
export function parseBulkUrls(raw) {
  return raw
    .split(/[,\n]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}
