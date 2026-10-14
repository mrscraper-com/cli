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
 * Retrieve one page through the Scraper API with the Python SDK's
 * `scraper_api()` options and defaults.
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.url
 * @param {boolean} [options.html]
 * @param {boolean} [options.markdown]
 * @param {number} [options.timeout] Page timeout in seconds (1–300).
 * @param {string} [options.geoCode]
 * @param {string | null} [options.proxyCountry]
 * @param {boolean} [options.blockResources]
 * @param {boolean | null} [options.browserRendering] null selects automatic browser fallback.
 * @param {boolean} [options.superMode]
 * @param {boolean} [options.useProxy]
 * @param {string | null} [options.proxy]
 * @param {string | null} [options.waitForSelector]
 * @param {boolean} [options.homePage] Sent as warmStart.
 * @param {boolean} [options.screenshot] Always enables browser rendering.
 * @param {boolean} [options.bypassProxy]
 * @param {string | null} [options.cookieJar]
 * @param {Record<string, string> | string | null} [options.headers] Target page request headers.
 * @param {number} [options.maxRetries]
 * @param {number | null} [options.tokenCap]
 * @param {boolean | null} [options.stream]
 * @param {string} [options.discardTokenSecret]
 */
export async function scraperApi({
  token,
  url,
  html = true,
  markdown = false,
  timeout = 120,
  geoCode = "US",
  proxyCountry = null,
  blockResources = false,
  browserRendering = null,
  superMode = false,
  useProxy = true,
  proxy = null,
  waitForSelector = null,
  homePage = false,
  screenshot = false,
  bypassProxy = false,
  cookieJar = null,
  headers = null,
  maxRetries = 3,
  tokenCap = null,
  stream = null,
  discardTokenSecret = "",
}) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
    throw new Error("timeout must be between 1 and 300 seconds");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("max retries must be a nonnegative integer");
  }
  if (tokenCap !== null && (!Number.isInteger(tokenCap) || tokenCap < 0)) {
    throw new Error("token cap must be a nonnegative integer");
  }
  const authHeaders = getAuthHeaders(token);
  return request("POST", SCRAPER_API_BASE_URL, {
    headers: {
      ...authHeaders,
      ...(discardTokenSecret
        ? { "x-discard-token-secret": discardTokenSecret }
        : {}),
    },
    params: compact({
      // The Scraper API reads the key from the query string, as the SDK sends it.
      token: authHeaders["x-api-token"],
      timeout,
      geoCode,
      proxyCountry,
      browserRendering: screenshot ? true : browserRendering,
      super: superMode ? true : null,
      useProxy: useProxy ? null : false,
      proxy,
      html,
      markdown,
      waitForSelector,
      warmStart: homePage ? true : null,
      screenshot: screenshot ? true : null,
      blockResources: blockResources ? true : null,
      bypassProxy: bypassProxy ? true : null,
      cookieJar,
      headers:
        headers && typeof headers === "object" ? JSON.stringify(headers) : headers,
      stream,
    }),
    json: compact({ url, maxRetries, tokenCap }),
    timeout: timeout + 30,
  });
}

/**
 * Accept query text or a Google search URL and derive the search fields.
 * @param {string} input
 */
export function normalizeSearchInput(input) {
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
 * Search Google with the Python SDK's `web_search()` options and defaults.
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.url Query text or a Google search URL.
 * @param {boolean} [options.raw] true requests HTML and overrides format.
 * @param {string | null} [options.region]
 * @param {string | null} [options.language]
 * @param {number | null} [options.page]
 * @param {'json' | 'html'} [options.format]
 * @param {boolean} [options.renderJs]
 * @param {number} [options.timeout] Local request deadline in seconds.
 */
export async function webSearchApi({
  token,
  url,
  raw = true,
  region = null,
  language = null,
  page = null,
  format = "json",
  renderJs = false,
  timeout = 600,
}) {
  if (!["json", "html"].includes(format)) {
    throw new Error("format must be json or html");
  }
  const normalized = normalizeSearchInput(url);
  return request("POST", `${SYNC_SCRAPER_BASE_URL}/api/google/serp/v2/sync`, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders(token),
    },
    json: compact({
      query: normalized.query,
      region: region || normalized.region,
      language: language || normalized.language,
      page: page || normalized.page,
      format: raw ? "html" : format,
      renderJs: Boolean(renderJs),
    }),
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
