import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  FETCH_HTML_BASE_URL,
  SYNC_SCRAPER_BASE_URL,
  fetchWithUnblockerApi,
  googleSerpSyncApi,
  normalizeSerpInput,
  request,
  sanitizeResponseData,
} from "../lib/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse(body, status = 200, contentType = "text/html") {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

test("request keeps the timeout active while reading the body", async () => {
  globalThis.fetch = async (_url, init) => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "text/plain" }),
    text: () =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  });

  const result = await request("GET", "https://example.com", { timeout: 0.01 });
  assert.equal(result.status_code, null);
  assert.equal(result.error, "Request timed out after 0.01s");
});

test("request safely falls back to text for malformed JSON", async () => {
  globalThis.fetch = async () =>
    mockResponse("{bad json", 200, "application/json; charset=utf-8");
  const result = await request("GET", "https://example.com");
  assert.equal(result.data, "{bad json");
});

test("request removes sensitive response headers", async () => {
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    headers: new Headers({
      "content-type": "text/plain",
      "set-cookie": "session=secret",
      "x-api-token": "secret-token",
      "x-request-id": "request-1",
    }),
    text: async () => "ok",
  });

  const result = await request("GET", "https://example.com");
  assert.deepEqual(result.headers, { "content-type": "text/plain", "x-request-id": "request-1" });
});

test("API calls send saved API keys through both compatibility headers", async () => {
  let capturedHeaders;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init.headers;
    return mockResponse("<html><h1>Available</h1></html>");
  };

  await fetchWithUnblockerApi({
    token: { auth_type: "api_key", api_key: "saved-secret" },
    url: "https://target.example",
    unblock: "never",
  });

  assert.equal(capturedHeaders.Authorization, "Bearer saved-secret");
  assert.equal(capturedHeaders["x-api-token"], "saved-secret");
});

test("response data redacts tokens in fields and generated curl commands", () => {
  const sanitized = sanitizeResponseData({
    latestApiToken: "atk_fakefakefakefake",
    tokenUsage: 12,
    curl: "curl 'https://api.example/?token=atk_fakefakefakefake' -H 'x-api-token: atk_fakefakefakefake'",
    nested: { authorization: "Bearer secret-value" },
  });

  assert.equal(sanitized.latestApiToken, "[REDACTED]");
  assert.equal(sanitized.tokenUsage, 12);
  assert.doesNotMatch(JSON.stringify(sanitized), /atk_fake|secret-value/);
  assert.match(sanitized.curl, /REDACTED/);
});

test("auto unblock escalates a challenge page to browser rendering", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    if (calls.length === 1) {
      return mockResponse("<html><div class='cf-chl-widget'>Checking your browser</div></html>");
    }
    return mockResponse("<html><h1>Available</h1></html>");
  };

  const result = await fetchWithUnblockerApi({
    token: "test-token",
    url: "https://target.example",
    unblock: "auto",
    timeout: 30,
    maxRetries: 2,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].origin, new URL(FETCH_HTML_BASE_URL).origin);
  assert.equal(calls[0].searchParams.get("browserRendering"), "false");
  assert.equal(calls[0].searchParams.get("maxRetries"), "0");
  assert.equal(calls[1].searchParams.get("browserRendering"), "true");
  assert.equal(calls[1].searchParams.get("maxRetries"), "2");
  assert.deepEqual(result.unblocker, {
    requested: "auto",
    browser_rendering: true,
    escalated: true,
    attempts: 2,
  });
  assert.match(result.data, /Available/);
});

test("auto unblock escalates retryable structured service failures", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return mockResponse(
        '{"detail":"Failed to open URL (ERR1). Please try again."}',
        500,
        "application/json",
      );
    }
    return mockResponse("<html><h1>Rendered</h1></html>");
  };

  const result = await fetchWithUnblockerApi({
    token: "test-token",
    url: "https://target.example",
    unblock: "auto",
  });
  assert.equal(calls, 2);
  assert.equal(result.status_code, 200);
  assert.equal(result.unblocker.escalated, true);
});

test("never mode rejects selector waiting before making a request", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return mockResponse("");
  };
  await assert.rejects(
    fetchWithUnblockerApi({
      token: "test-token",
      url: "https://target.example",
      unblock: "never",
      waitForSelector: ".ready",
    }),
    /wait-for requires browser rendering/,
  );
  assert.equal(called, false);
});

test("SERP accepts a plain query and sends the documented v2 payload", async () => {
  let capturedUrl;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return mockResponse('{"success":true}', 200, "application/json");
  };

  await googleSerpSyncApi({
    token: "test-token",
    query: "iphone 17",
    region: "id",
    language: "id",
    page: 2,
    format: "json",
    renderJs: true,
  });

  assert.equal(
    capturedUrl,
    `${SYNC_SCRAPER_BASE_URL}/api/google/serp/v2/sync`,
  );
  assert.deepEqual(capturedBody, {
    query: "iphone 17",
    region: "id",
    language: "id",
    page: 2,
    format: "json",
    renderJs: true,
  });
});

test("SERP preserves Google URL compatibility", () => {
  assert.deepEqual(
    normalizeSerpInput(
      "https://www.google.com/search?q=running+shoes&gl=us&hl=en&start=20",
    ),
    {
      query: "running shoes",
      region: "us",
      language: "en",
      page: 3,
    },
  );
});

test("SERP omits optional fields when only a query is provided", async () => {
  let capturedBody;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return mockResponse('{"success":true}', 200, "application/json");
  };

  await googleSerpSyncApi({ token: "test-token", query: "mrscraper" });
  assert.deepEqual(capturedBody, {
    query: "mrscraper",
    format: "json",
    renderJs: false,
  });
});

test("the public package entry point imports successfully", async () => {
  const exports = await import("../lib/index.js");
  assert.equal(exports.SYNC_SCRAPER_BASE_URL, SYNC_SCRAPER_BASE_URL);
  assert.equal(typeof exports.fetchWithUnblockerApi, "function");
  assert.equal(typeof exports.getSubscriptionAccountApi, "function");
});
