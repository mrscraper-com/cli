import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SCRAPER_API_BASE_URL,
  request,
  sanitizeResponseData,
  scrapeHtml,
  scrapeMarkdown,
  getScreenshot,
  scrapeJson,
  scrapeBrand,
  webSearch,
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
  assert.deepEqual(result.headers, {
    "content-type": "text/plain",
    "x-request-id": "request-1",
  });
});

test("API calls send saved API keys through both compatibility headers", async () => {
  let capturedHeaders;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init.headers;
    return mockResponse("<html><h1>Available</h1></html>");
  };

  await scrapeHtml({
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

function captureRequests(body = "<html></html>", contentType = "text/html") {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    calls.push({
      method: init.method,
      origin: parsed.origin,
      query: Object.fromEntries(parsed.searchParams),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    return mockResponse(body, 200, contentType);
  };
  return calls;
}

const PAGE_DEFAULTS = {
  url: "https://target.example/?q=a&b=c",
  super: "false",
  waitUntil: "domcontentloaded",
  timeout: "300",
  geoCode: "us",
  proxyCountry: "us",
  saveResult: "false",
};
const LOADING_DEFAULTS = { blockResources: "false", returnCookie: "false" };

test("page commands send documented defaults and forced fields over GET", async () => {
  const calls = captureRequests("Authorization: Bearer documentation-example");
  // Disabled fields must never reach the wire, even from programmatic callers.
  const options = {
    token: "test-token",
    url: PAGE_DEFAULTS.url,
    tokenCap: 1,
    record: true,
    action: "custom",
  };
  const html = await scrapeHtml(options);
  await scrapeMarkdown(options);
  await getScreenshot({ ...options, browserRendering: false });
  await scrapeJson({
    ...options,
    waitForSelector: ".ignored",
    blockResources: true,
    returnCookie: true,
  });

  assert.equal(html.data, "Authorization: Bearer documentation-example");
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.body, undefined);
    assert.equal(call.origin, new URL(SCRAPER_API_BASE_URL).origin);
  }
  assert.deepEqual(
    calls.map((call) => call.query),
    [
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "false",
        html: "true",
        markdown: "false",
        screenshot: "false",
      },
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "false",
        html: "false",
        markdown: "true",
        screenshot: "false",
      },
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "true",
        screenshot: "full",
        html: "true",
        markdown: "false",
      },
      {
        ...PAGE_DEFAULTS,
        browserRendering: "false",
        html: "false",
        screenshot: "false",
        agent: "general",
        prompt: "Extract all data as complete as possible.",
      },
    ],
  );
});

test("page options map to their documented query fields", async () => {
  const calls = captureRequests();
  await scrapeMarkdown({
    token: "test-token",
    url: "https://target.example",
    html: true,
    browserRendering: true,
    superMode: true,
    waitUntil: "networkidle0",
    waitForSelector: " .ready ",
    timeout: 60,
    blockResources: true,
    geoCode: "ID",
    proxyCountry: "SG",
    returnCookie: true,
    proxy: "http://user:pass@proxy.example:8080",
    maxRetries: 0,
    saveResult: true,
  });
  await getScreenshot({
    token: "test-token",
    url: "https://target.example",
    screenshot: "top",
    html: false,
    markdown: true,
  });
  await scrapeMarkdown({
    token: "test-token",
    url: "https://target.example",
    html: true,
  });
  assert.deepEqual(calls[0].query, {
    url: "https://target.example",
    super: "true",
    waitUntil: "networkidle0",
    timeout: "60",
    geoCode: "id",
    proxyCountry: "sg",
    proxy: "http://user:pass@proxy.example:8080",
    maxRetries: "0",
    saveResult: "true",
    blockResources: "true",
    waitForSelector: ".ready",
    returnCookie: "true",
    browserRendering: "true",
    html: "true",
    markdown: "true",
    screenshot: "false",
  });
  assert.equal(calls[1].query.screenshot, "top");
  assert.equal(calls[1].query.html, "false");
  assert.equal(calls[1].query.markdown, "true");
  assert.equal(calls[2].query.browserRendering, "true");
});

test("invalid inputs fail before fetching", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return mockResponse("");
  };
  const options = { token: "test-token", url: "https://target.example" };
  for (const timeout of [0, 301, 1.5]) {
    await assert.rejects(scrapeHtml({ ...options, timeout }), /timeout/);
  }
  await assert.rejects(
    scrapeHtml({ ...options, maxRetries: -1 }),
    /max retries/,
  );
  await assert.rejects(
    scrapeHtml({ ...options, url: "file:///tmp/test" }),
    /HTTP/,
  );
  await assert.rejects(
    scrapeHtml({ ...options, waitUntil: "invalid" }),
    /wait until/,
  );
  await assert.rejects(scrapeHtml({ ...options, geoCode: "usa" }), /geo code/);
  await assert.rejects(
    scrapeMarkdown({ ...options, proxyCountry: "1" }),
    /proxy country/,
  );
  await assert.rejects(
    scrapeHtml({ ...options, waitForSelector: " " }),
    /wait for selector/,
  );
  await assert.rejects(
    getScreenshot({ ...options, screenshot: "invalid" }),
    /screenshot/,
  );
  await assert.rejects(scrapeJson({ ...options, prompt: " " }), /prompt/);
  await assert.rejects(scrapeBrand({ ...options, url: "example.com" }), /HTTP/);
  for (const numResults of [0, 9, 101, 10.5]) {
    await assert.rejects(
      webSearch({ token: "test-token", query: "test", numResults }),
      /num results/,
    );
  }
  for (const query of [" ", "x".repeat(1001), undefined]) {
    await assert.rejects(webSearch({ token: "test-token", query }), /query/);
  }
  await assert.rejects(
    webSearch({ token: "test-token", query: "test", country: "usa" }),
    /country/,
  );
  assert.equal(requests, 0);
});

test("network errors report their cause without echoing the API key", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: new Error("other side closed by atk_networkerrorsecret1234"),
    });
  };
  const result = await scrapeHtml({
    token: "atk_networkerrorsecret1234",
    url: "https://target.example",
  });
  assert.equal(result.status_code, null);
  assert.equal(
    result.error,
    "fetch failed (other side closed by [REDACTED_API_TOKEN])",
  );
});

test("JSON extraction falls back to the POST body only for prompts too long for a URL", async () => {
  const calls = captureRequests(
    JSON.stringify({ success: true, runtime: 1, data: { token: "value" } }),
    "application/json",
  );
  const options = { token: "test-token", url: "https://target.example" };
  const result = await scrapeJson({ ...options, prompt: "Extract prices" });
  const longPrompt = "Extract all fields. Json Schema: " + "x".repeat(8000);
  await scrapeJson({ ...options, prompt: longPrompt, html: true });

  assert.equal(result.data.data.token, "value");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].query.prompt, "Extract prices");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(calls[1].body, {
    url: "https://target.example",
    prompt: longPrompt,
    agent: "general",
  });
  assert.equal(calls[1].query.html, "true");
  for (const field of ["url", "prompt", "agent"]) {
    assert.equal(field in calls[1].query, false, field);
  }
});

test("brand and web search send only their documented GET fields", async () => {
  const calls = captureRequests('{"success":true}', "application/json");
  await scrapeBrand({
    token: "test-token",
    url: "https://mrscraper.com/",
    bundle: "full",
  });
  await webSearch({ token: "test-token", query: " mrscraper " });
  await webSearch({
    token: "test-token",
    query: "e-menessaptieka.lv linkedin",
    country: "ID",
    numResults: 100,
  });
  assert.ok(calls.every((call) => call.method === "GET" && !call.body));
  assert.deepEqual(
    calls.map((call) => call.query),
    [
      { action: "brand-scraping", url: "https://mrscraper.com/", bundle: "none" },
      { action: "websearch", query: "mrscraper", country: "us", numResults: "10" },
      {
        action: "websearch",
        query: "e-menessaptieka.lv linkedin",
        country: "id",
        numResults: "100",
      },
    ],
  );
});

test("the public package exports the six operations", async () => {
  const exports = await import("../lib/index.js");
  for (const name of [
    "scrapeHtml",
    "scrapeMarkdown",
    "getScreenshot",
    "scrapeBrand",
    "scrapeJson",
    "webSearch",
    "getSubscriptionAccountApi",
  ]) {
    assert.equal(typeof exports[name], "function", name);
  }
  for (const name of ["scraperApi", "webSearchApi", "getBrand"]) {
    assert.equal(exports[name], undefined, name);
  }
});
