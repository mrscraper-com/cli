import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SCRAPER_API_BASE_URL,
  SYNC_SCRAPER_BASE_URL,
  scraperAPI,
  webSearch,
  account,
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

  await scraperAPI({
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

test("SERP accepts a plain query and sends the documented v2 payload", async () => {
  let capturedUrl;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return mockResponse('{"success":true}', 200, "application/json");
  };

  await webSearch({
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

  await webSearch({ token: "test-token", query: "mrscraper" });
  assert.deepEqual(capturedBody, {
    query: "mrscraper",
    format: "json",
    renderJs: false,
  });
});

test("the public package entry point imports successfully", async () => {
  const exports = await import("../lib/index.js");
  assert.equal(exports.SYNC_SCRAPER_BASE_URL, SYNC_SCRAPER_BASE_URL);
  assert.equal(exports.scraperAPI, scraperAPI);
  assert.equal(exports.webSearch, webSearch);
  assert.equal(exports.account, account);
  for (const name of ["fetchContentApi", "fetchHtmlApi", "googleSerpSyncApi", "getSubscriptionAccountApi", "createAiScraperApi", "rerunAiScraperApi", "getAllResultsApi"]) {
    assert.equal(name in exports, false, name);
  }
});

test("scraperAPI matches the SDK POST contract including screenshot and warmStart", async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: new URL(url), init };
    return mockResponse('{"ok":true}', 200, "application/json");
  };
  const result = await scraperAPI({
    token: { auth_type: "api_key", api_key: "test-token" },
    url: "https://example.com", timeout: 45, html: false, markdown: true,
    screenshot: true, browserRendering: false, homePage: true,
    super: true, useProxy: false, geoCode: "ID", proxyCountry: "SG",
    proxy: "proxy.example:8000", waitForSelector: ".ready", blockResources: true,
    bypassProxy: true, cookieJar: "domain=example.com", headers: { "x-target": "yes" },
    maxRetries: 4, tokenCap: 0, stream: false, discardTokenSecret: "discard-secret",
  });
  assert.equal(call.init.method, "POST");
  assert.deepEqual(JSON.parse(call.init.body), { url: "https://example.com", maxRetries: 4, tokenCap: 0 });
  assert.equal(call.init.headers.Authorization, "Bearer test-token");
  assert.equal(call.init.headers["x-discard-token-secret"], "discard-secret");
  assert.deepEqual(Object.fromEntries(call.url.searchParams), {
    token: "test-token", timeout: "45", geoCode: "ID", proxyCountry: "SG",
    browserRendering: "true", super: "true", useProxy: "false", proxy: "proxy.example:8000",
    html: "false", markdown: "true", waitForSelector: ".ready", warmStart: "true",
    screenshot: "true", blockResources: "true", bypassProxy: "true",
    cookieJar: "domain=example.com", headers: '{"x-target":"yes"}', stream: "false",
  });
  assert.deepEqual(result.data, { ok: true });
});

test("scraperAPI defaults to automatic browser fallback and validates retry budgets", async () => {
  globalThis.fetch = async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.has("browserRendering"), false);
    assert.equal(params.get("html"), "true");
    assert.equal(params.get("markdown"), "false");
    assert.equal(params.get("timeout"), "120");
    assert.equal(params.get("geoCode"), "US");
    assert.deepEqual(JSON.parse(init.body), { url: "https://example.com", maxRetries: 3 });
    return mockResponse("<html>page</html>");
  };
  await scraperAPI({ token: "test-token", url: "https://example.com" });
  globalThis.fetch = async () => assert.fail("should not fetch");
  for (const options of [{ timeout: 301 }, { maxRetries: -1 }, { tokenCap: -1 }]) {
    await assert.rejects(scraperAPI({ token: "test-token", url: "https://example.com", ...options }));
  }
});

test("account sends an authenticated GET and omits billing identifiers and API keys", async () => {
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/subscription-accounts$/);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.headers["x-api-token"], "test-token");
    return mockResponse(JSON.stringify({ data: {
      stripeStatus: "active", tokenLimit: 100, tokenUsage: 25,
      stripeSubscriptionId: "sub_private", user: { name: "Ada", latestApiToken: "private-key" },
    } }), 200, "application/json");
  };
  const response = await account({ token: "test-token" });
  assert.equal(response.data.token_remaining, 75);
  assert.equal(response.data.subscription_status, "active");
  assert.equal(response.data.user.name, "Ada");
  assert.doesNotMatch(JSON.stringify(response), /private|stripeSubscriptionId|latestApiToken/);
});

test("account reports HTTP and malformed payload failures", async () => {
  for (const status of [401, 403, 500]) {
    globalThis.fetch = async () => mockResponse('{"message":"failed"}', status, "application/json");
    const result = await account({ token: "test-token" });
    assert.equal(result.status_code, status);
    assert.ok(result.error);
  }
  globalThis.fetch = async () => mockResponse('{"data":null}', 200, "application/json");
  assert.match((await account({ token: "test-token" })).error, /Account response must contain an object/);
  await assert.rejects(account({ token: "test-token", timeout: 0 }), /timeout/);
});

test("scraperAPI transport errors do not expose query credentials", async () => {
  globalThis.fetch = async (url) => { throw new Error(`Connection failed: ${url}`); };
  const response = await scraperAPI({ token: "private-key", url: "https://example.com" });
  assert.doesNotMatch(response.error, /private-key/);
  assert.match(response.error, /REDACTED/);
});
