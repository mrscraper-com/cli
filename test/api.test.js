import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SCRAPER_API_BASE_URL,
  SYNC_SCRAPER_BASE_URL,
  normalizeSearchInput,
  request,
  sanitizeResponseData,
  scraperApi,
  webSearchApi,
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

  await scraperApi({
    token: { auth_type: "api_key", api_key: "saved-secret" },
    url: "https://target.example",
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

test("response redaction preserves extracted data exactly", () => {
  const extracted = {
    token: "a legitimate scraped field",
    password: "a product named Password",
    example: "Authorization: Bearer documentation-example",
  };
  const sanitized = sanitizeResponseData({
    message: "ok",
    data: {
      id: "run-1",
      scraperId: "scraper-1",
      status: "Finished",
      data: extracted,
      curl: "curl -H 'x-api-token: atk_fakefakefakefake'",
    },
  });

  assert.deepEqual(sanitized.data.data, extracted);
  assert.match(sanitized.data.curl, /REDACTED/);
});

test("scraper API uses the SDK defaults in one POST and keeps the page body exact", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return mockResponse(
      "<html><p>Authorization: Bearer documentation-example</p></html>",
    );
  };

  const result = await scraperApi({
    token: "test-token",
    url: "https://target.example",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].url.origin, new URL(SCRAPER_API_BASE_URL).origin);
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    token: "test-token",
    timeout: "120",
    geoCode: "US",
    html: "true",
    markdown: "false",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: "https://target.example",
    maxRetries: 3,
  });
  assert.match(result.data, /Authorization: Bearer documentation-example/);
});

test("scraper API rejects a timeout outside 1 to 300 seconds without a request", async () => {
  globalThis.fetch = async () => {
    throw new Error("no request expected");
  };
  for (const timeout of [0, 301, 1.5]) {
    await assert.rejects(
      scraperApi({ token: "test-token", url: "https://target.example", timeout }),
      /timeout must be between 1 and 300 seconds/,
    );
  }
});

test("network errors never echo the API key from the query string", async () => {
  globalThis.fetch = async (url) => {
    throw new Error(`connect ECONNREFUSED while requesting ${url}`);
  };
  const result = await scraperApi({
    token: "atk_networkerrorsecret1234",
    url: "https://target.example",
  });
  assert.equal(result.status_code, null);
  assert.doesNotMatch(result.error, /networkerrorsecret/);
});

test("web search requests HTML by default, as the SDK does, and JSON when raw is false", async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${SYNC_SCRAPER_BASE_URL}/api/google/serp/v2/sync`);
    bodies.push(JSON.parse(init.body));
    return mockResponse('{"success":true}', 200, "application/json");
  };

  await webSearchApi({ token: "test-token", url: "mrscraper" });
  await webSearchApi({
    token: "test-token",
    url: "iphone 17",
    raw: false,
    region: "id",
    language: "id",
    page: 2,
    renderJs: true,
  });

  assert.deepEqual(bodies, [
    { query: "mrscraper", format: "html", renderJs: false },
    {
      query: "iphone 17",
      region: "id",
      language: "id",
      page: 2,
      format: "json",
      renderJs: true,
    },
  ]);
});

test("web search derives the query, locale, and page from a Google URL", () => {
  assert.deepEqual(
    normalizeSearchInput(
      "https://www.google.com/search?q=running+shoes&gl=us&hl=en&start=20",
    ),
    { query: "running shoes", region: "us", language: "en", page: 3 },
  );
  assert.deepEqual(
    normalizeSearchInput("https://www.google.com/search?q=shoes&start=abc"),
    { query: "shoes", region: null, language: null, page: null },
  );
  assert.throws(
    () => normalizeSearchInput("https://www.google.com/search?hl=en"),
    /must contain a q parameter/,
  );
});

test("the public package entry point imports successfully", async () => {
  const exports = await import("../lib/index.js");
  assert.equal(exports.SYNC_SCRAPER_BASE_URL, SYNC_SCRAPER_BASE_URL);
  assert.equal(typeof exports.scraperApi, "function");
  assert.equal(typeof exports.webSearchApi, "function");
  assert.equal(typeof exports.getSubscriptionAccountApi, "function");
});
