import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SCRAPER_API_BASE_URL,
  SYNC_SCRAPER_BASE_URL,
  scraperHtml,
  scraperMarkdown,
  getScreenshot,
  scraperJson,
  scraperMultiplePage,
  scraperSitemap,
  scrapeBrand,
  getBrand,
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

  await scraperHtml({
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
    raw: false,
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
    format: "html",
    renderJs: false,
  });
});

test("the public package entry point imports successfully", async () => {
  const exports = await import("../lib/index.js");
  assert.equal(exports.SYNC_SCRAPER_BASE_URL, SYNC_SCRAPER_BASE_URL);
  assert.equal(exports.scraperHtml, scraperHtml);
  assert.equal(exports.webSearch, webSearch);
  assert.equal(exports.account, account);
  for (const name of ["scraperAPI", "fetchContentApi", "fetchHtmlApi", "googleSerpSyncApi", "getSubscriptionAccountApi", "createAiScraperApi", "rerunAiScraperApi", "getAllResultsApi"]) {
    assert.equal(name in exports, false, name);
  }
});

test("format-specific operations match the Python SDK contracts", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ params: new URL(url).searchParams, init });
    return mockResponse('{"ok":true}', 200, "application/json");
  };
  const base = { token: "test-token", url: "https://example.com" };
  const cases = [
    [scraperHtml, { html: "true" }, { url: base.url, maxRetries: 3 }],
    [scraperMarkdown, { markdown: "true" }, { url: base.url, maxRetries: 3 }],
    [scraperJson, { html: "true" }, { url: base.url, maxRetries: 3, prompt: "Extract all data as complete as possible.", agent: "general" }],
    [scraperMultiplePage, {}, { url: base.url, maxRetries: 3, prompt: "Extract all entry data as complete as possible.", agent: "listing", maxPages: 3 }],
    [scraperSitemap, {}, { url: base.url, maxRetries: 3, agent: "map", maxPages: 3, maxDepth: 2, limit: 1000 }],
    [scrapeBrand, { action: "brand-scraping", bundle: "clean", url: base.url, maxRetries: "3" }, { url: base.url }],
  ];
  for (const [service, flags, body] of cases) {
    await service(base);
    const { params, init } = calls.at(-1);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), body);
    for (const flag of ["html", "markdown", "screenshot", "agent", "action", "bundle", "url", "maxRetries"]) {
      assert.equal(params.get(flag), flags[flag] ?? null, `${service.name}: ${flag}`);
    }
    assert.equal(params.get("timeout"), "120");
    assert.equal(params.get("geoCode"), "US");
    assert.equal(params.has("browserRendering"), false);
  }
});

test("shared page controls preserve explicit false, zero budgets, headers and pattern strings", async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { params: new URL(url).searchParams, init };
    return mockResponse('{"ok":true}', 200, "application/json");
  };
  await scraperSitemap({
    token: "test-token", url: "https://example.com", timeout: 45,
    browserRendering: false, homePage: true, super: true, useProxy: false,
    geoCode: "ID", proxyCountry: "SG", proxy: "proxy.example:8000",
    waitForSelector: ".ready", waitUntil: "networkidle", blockResources: true,
    bypassProxy: true, cookieJar: "domain=example.com", headers: { "x-target": "yes" },
    maxRetries: 4, tokenCap: 0, stream: false, discardTokenSecret: "discard-secret",
    maxPages: 5, maxDepth: 0, limit: 20, includePatterns: String.raw`https:\/\/example\.com/products/.*`, excludePatterns: "/blog/*",
  });
  assert.equal(call.init.headers["x-discard-token-secret"], "discard-secret");
  assert.equal(call.init.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(call.init.body);
  assert.equal(body.includePatterns, String.raw`https:\/\/example\.com/products/.*`);
  assert.equal(body.excludePatterns, "/blog/*");
  assert.equal(body.tokenCap, 0);
  assert.equal(body.maxDepth, 0);
  for (const [key, value] of Object.entries({ browserRendering: "false", stream: "false", super: "true", warmStart: "true", useProxy: "false", waitUntil: "networkidle", headers: '{"x-target":"yes"}' })) {
    assert.equal(call.params.get(key), value, key);
  }
});

test("screenshot GET uses query retries and full-page defaults", async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { params: new URL(url).searchParams, init };
    return new Response(Uint8Array.from([137, 80, 78, 71, 0, 255]), { headers: { "content-type": "image/png" } });
  };
  const result = await getScreenshot({ token: "test-token", url: "https://example.com", tokenCap: 0, timeout: undefined, waitUntil: undefined });
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.body, undefined);
  for (const [key, value] of Object.entries({ screenshot: "full", browserRendering: "true", timeout: "300", waitUntil: "domcontentloaded", maxRetries: "3", tokenCap: "0", url: "https://example.com" })) {
    assert.equal(call.params.get(key), value, key);
  }
  assert.equal(call.params.has("html"), false);
  assert.equal(call.params.has("markdown"), false);
  assert.deepEqual(result.data, Buffer.from([137, 80, 78, 71, 0, 255]));
  await getScreenshot({ token: "test-token", url: "https://example.com", fullPage: false });
  assert.equal(call.params.get("screenshot"), "true");
});

test("brand creation supports every bundle and retrieval preserves binary downloads", async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: new URL(url), init };
    return new Response(Uint8Array.from([80, 75, 3, 4, 0, 255]), { headers: { "content-type": "application/zip" } });
  };
  for (const bundle of ["clean", "full", "none"]) {
    await scrapeBrand({ token: "test-token", url: "https://example.com", bundle, tokenCap: 0 });
    assert.equal(call.url.searchParams.get("bundle"), bundle);
    assert.equal(call.url.searchParams.get("tokenCap"), "0");
    assert.deepEqual(JSON.parse(call.init.body), { url: "https://example.com" });
  }
  const result = await getBrand({ token: "test-token", jobId: "job with space", output: "bundle" });
  assert.equal(call.url.pathname, "/neo/brand");
  assert.equal(call.url.searchParams.get("id"), "job with space");
  assert.equal(call.url.searchParams.get("output"), "bundle");
  assert.equal(call.init.method, "GET");
  assert.deepEqual(result.data, Buffer.from([80, 75, 3, 4, 0, 255]));
});

test("scraping rejects invalid controls before making a request", async () => {
  globalThis.fetch = async () => assert.fail("should not fetch");
  const base = { token: "test-token", url: "https://example.com" };
  for (const options of [{ timeout: 301 }, { maxRetries: -1 }, { maxRetries: null }, { tokenCap: -1 }, { super: "true" }]) {
    await assert.rejects(scraperHtml({ ...base, ...options }));
  }
  for (const options of [{ maxPages: 0 }, { maxDepth: -1 }, { limit: 0 }]) await assert.rejects(scraperSitemap({ ...base, ...options }));
  await assert.rejects(getScreenshot({ ...base, fullPage: "true" }));
  await assert.rejects(scrapeBrand({ ...base, bundle: "invalid" }));
  for (const options of [{ jobId: "" }, { jobId: "job", output: "invalid" }, { jobId: "job", timeout: 0 }]) await assert.rejects(getBrand({ token: "test-token", ...options }));
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
  const response = await scraperHtml({ token: "private-key", url: "https://example.com" });
  assert.doesNotMatch(response.error, /private-key/);
  assert.match(response.error, /REDACTED/);
});


test("structured extraction preserves page fields named token, secret and password", async () => {
  const payload = { products: [{ token: "product-token", secret: "product-secret", password: "example-field" }], data: { apiKey: "documented-example" } };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/vendor+json" } });
  const result = await scraperJson({ token: "test-token", url: "https://example.com" });
  assert.deepEqual(result.data, payload);
});

test("nonstandard archive MIME remains binary while XML remains text", async () => {
  const bytes = Buffer.from([80, 75, 3, 4, 0, 255]);
  for (const type of ["application/x-zip-compressed", "application/pdf"]) {
    globalThis.fetch = async () => new Response(bytes, { headers: { "content-type": type } });
    const result = await getBrand({ token: "test-token", jobId: "job-1", output: "bundle" });
    assert.deepEqual(result.data, bytes);
  }
  globalThis.fetch = async () => new Response("<xml>test</xml>", { headers: { "content-type": "application/xml" } });
  assert.equal((await scraperHtml({ token: "test-token", url: "https://example.com" })).data, "<xml>test</xml>");
});
