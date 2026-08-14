const DEFAULT_TIMEOUT = 600;
export const API_BASE_URL = "https://api.app.mrscraper.com/api/v1";
export const FETCH_HTML_BASE_URL = "https://api.mrscraper.com";
export const SYNC_SCRAPER_BASE_URL = "https://sync.scraper.mrscraper.com";
export const APP_BASE_URL = "https://app.mrscraper.com";

function getAuthHeaders(token) {
  const trimmed = token.trim();
  const authValue = /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;

  return {
    Authorization: authValue,
    "x-api-token": trimmed,
  };
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
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    fullUrl = u.toString();
  }

  const controller = new AbortController();
  const ms = Math.ceil(timeout * 1000);
  const timer = setTimeout(() => controller.abort(), ms);

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
    clearTimeout(timer);

    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    /** @type {unknown} */
    let data;
    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch {
        data = await response.text();
      }
    } else {
      data = await response.text();
    }

    const headerObj = Object.fromEntries(response.headers.entries());

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
  } catch (exc) {
    clearTimeout(timer);
    const message = exc instanceof Error ? exc.message : String(exc);
    return {
      error: message.includes("aborted")
        ? `Request timed out after ${timeout}s`
        : message,
      status_code: null,
      data: null,
      headers: {},
    };
  }
}

/**
 * @param {string} token
 * @param {string} url
 * @param {number} [timeout]
 * @param {string} [geoCode]
 * @param {boolean} [blockResources]
 */
export async function fetchHtmlApi(
  token,
  url,
  timeout = 120,
  geoCode = "US",
  blockResources = false,
) {
  const headers = { ...getAuthHeaders(token) };

  // Cleaned up: token removed from URL params and passed into headers
  const params = {
    timeout: String(timeout),
    geoCode,
    url,
    blockResources: String(blockResources).toLowerCase(),
  };

  return request("GET", FETCH_HTML_BASE_URL, {
    headers,
    params,
    timeout: timeout + 30,
  });
}

/**
 * @param {object} p
 * @param {string} p.token
 * @param {string} p.url
 * @param {string} p.message
 * @param {'general' | 'listing' | 'map'} [p.agent]
 * @param {string | null} [p.proxyCountry]
 * @param {number} [p.maxDepth]
 * @param {number} [p.maxPages]
 * @param {number} [p.limit]
 * @param {string} [p.includePatterns]
 * @param {string} [p.excludePatterns]
 */
export async function createAiScraperApi({
  token,
  url,
  message,
  agent = "general",
  proxyCountry = null,
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

  /** @type {Record<string, unknown>} */
  let payload;
  if (agent === "general" || agent === "listing") {
    payload = {
      url,
      message,
      agent,
      proxyCountry: proxyCountry,
    };
    if (agent === "listing") payload.maxPages = maxPages;
  } else {
    payload = {
      url,
      agent,
      maxDepth,
      maxPages,
      limit,
      includePatterns,
      excludePatterns,
    };
  }

  return request("POST", `${API_BASE_URL}/scrapers-ai`, {
    headers,
    json: payload,
  });
}

/** @param {object} p */
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

/** @param {object} p */
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

/** @param {object} p */
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

/** @param {object} p */
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

/** @param {object} p */
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

  /** @type {Record<string, string | number>} */
  const params = {
    sortField,
    sortOrder,
    pageSize,
    page,
  };
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

/**
 * @param {object} p
 * @param {string} p.token
 * @param {string} p.url
 * @param {boolean} [p.raw]
 * @param {number} [p.timeout]
 */
export async function googleSerpSyncApi({
  token,
  url,
  raw = false,
  timeout = 120,
}) {
  const headers = {
    accept: "application/json",
    ...getAuthHeaders(token),
  };
  return request(
    "POST",
    `${SYNC_SCRAPER_BASE_URL}/api/google/serp/sync`,
    {
      headers,
      json: { url, raw },
      timeout,
    },
  );
}

/**
 * Best-effort token check against the cheapest authenticated endpoint.
 * @param {string} token
 */
export async function validateTokenApi(token) {
  return getAllResultsApi({ token, pageSize: 1, page: 1 });
}

/** @param {string} raw */
export function parseBulkUrls(raw) {
  return raw
    .split(/[,|\n]/g)
    .map((p) => p.trim())
    .filter(Boolean);
}
