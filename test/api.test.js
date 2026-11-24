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

const PAGE_URL = "https://target.example/?q=a&b=c";
const SHARED_DEFAULTS = { timeout: "300", saveResult: "true", maxAge: "0" };
const LOADING_DEFAULTS = { warmStart: "false", blockResources: "false" };
// Fields that earlier releases sent but that are no longer options: the
// reference no longer lists them, or the value is fixed (saveResult) or never
// sent (tokenCap).
const UNDOCUMENTED = {
  saveResult: false,
  tokenCap: 5,
  record: true,
  super: true,
  superMode: true,
  waitUntil: "load",
  proxyCountry: "sg",
  proxy: "http://user:pass@proxy.example:8080",
  returnCookie: true,
  markdown: true,
  bundle: "full",
};

test("page commands send documented defaults and forced fields over GET", async () => {
  const calls = captureRequests("Authorization: Bearer documentation-example");
  const options = { token: "test-token", url: PAGE_URL, ...UNDOCUMENTED };
  const html = await scrapeHtml(options);
  await scrapeMarkdown({ ...options, html: true, screenshot: "top" });
  await getScreenshot({
    ...options,
    browserRendering: false,
    screenshot: "top",
    html: false,
    warmStart: true,
    blockResources: true,
    action: "custom",
  });
  await scrapeJson({ ...options, action: "custom" });

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
        url: PAGE_URL,
        html: "true",
        markdown: "false",
        ...LOADING_DEFAULTS,
        ...SHARED_DEFAULTS,
        screenshot: "false",
      },
      {
        url: PAGE_URL,
        markdown: "true",
        html: "false",
        screenshot: "false",
        ...LOADING_DEFAULTS,
        ...SHARED_DEFAULTS,
      },
      {
        url: PAGE_URL,
        screenshot: "full",
        html: "false",
        markdown: "false",
        browserRendering: "true",
        ...SHARED_DEFAULTS,
      },
      {
        url: PAGE_URL,
        prompt: "Extract all data as complete as possible.",
        agent: "general",
        html: "true",
        ...LOADING_DEFAULTS,
        ...SHARED_DEFAULTS,
        screenshot: "false",
      },
    ],
  );
});

test("page options map to their documented query fields in order", async () => {
  const calls = captureRequests();
  const url = "https://target.example";
  const options = {
    token: "test-token",
    url,
    browserRendering: false,
    timeout: 330,
    warmStart: true,
    blockResources: true,
    waitForSelector: " .ready ",
    geoCode: "ID",
    maxAge: 604800000,
    maxRetries: 0,
  };
  await scrapeHtml({
    ...options,
    action: " analytics ",
    screenshot: "1920x1080-75",
  });
  await scrapeMarkdown({
    ...options,
    browserRendering: true,
    action: "analytics",
  });
  await getScreenshot(options);
  await scrapeJson({
    ...options,
    prompt: "Extract prices",
    html: false,
    screenshot: true,
  });

  const loading = { warmStart: "true", blockResources: "true" };
  const shared = {
    timeout: "330",
    waitForSelector: ".ready",
    geoCode: "id",
    saveResult: "true",
    maxAge: "604800000",
    maxRetries: "0",
  };
  // A screenshot needs a rendered page, so it overrides browserRendering=false.
  assert.deepEqual(calls[0].query, {
    url,
    html: "true",
    markdown: "false",
    browserRendering: "true",
    ...loading,
    action: "analytics",
    ...shared,
    screenshot: "1920x1080-75",
  });
  assert.deepEqual(calls[1].query, {
    url,
    markdown: "true",
    html: "false",
    screenshot: "false",
    browserRendering: "true",
    ...loading,
    action: "analytics",
    ...shared,
  });
  assert.deepEqual(calls[2].query, {
    url,
    screenshot: "full",
    html: "false",
    markdown: "false",
    browserRendering: "true",
    ...shared,
  });
  assert.deepEqual(calls[3].query, {
    url,
    prompt: "Extract prices",
    agent: "general",
    html: "false",
    browserRendering: "false",
    ...loading,
    ...shared,
    screenshot: "true",
  });
  assert.deepEqual(Object.keys(calls[0].query), [
    "url",
    "html",
    "markdown",
    "browserRendering",
    "timeout",
    "warmStart",
    "blockResources",
    "waitForSelector",
    "action",
    "geoCode",
    "saveResult",
    "maxAge",
    "maxRetries",
    "screenshot",
  ]);
});

test("browser rendering is omitted unless set and preserves false", async () => {
  const calls = captureRequests();
  for (const operation of [scrapeHtml, scrapeMarkdown, scrapeJson]) {
    for (const browserRendering of [undefined, null, true, false]) {
      await operation({
        token: "test",
        url: "https://example.com",
        browserRendering,
      });
      assert.equal(
        calls.at(-1).query.browserRendering,
        browserRendering == null ? undefined : String(browserRendering),
      );
    }
  }
});

test("Scrape HTML accepts every documented screenshot capture", async () => {
  const calls = captureRequests();
  const accepted = [
    false,
    "full",
    "top",
    "100x100",
    "1280x800",
    "3840x3840",
    "1280x800-25",
    "1920x1080-300",
  ];
  for (const screenshot of accepted) {
    for (const browserRendering of [undefined, true, false]) {
      await scrapeHtml({
        token: "test",
        url: "https://example.com",
        screenshot,
        browserRendering,
      });
      const { query } = calls.at(-1);
      assert.equal(query.screenshot, String(screenshot));
      // Any screenshot sends browserRendering=true; without one it is untouched.
      assert.equal(
        query.browserRendering,
        screenshot === false
          ? browserRendering === undefined
            ? undefined
            : String(browserRendering)
          : "true",
        `${screenshot} with browserRendering ${browserRendering}`,
      );
    }
  }
  for (const screenshot of [
    true,
    "",
    "FULL",
    "bottom",
    "99x800",
    "1280x3841",
    "12345x800",
    "1280x800-24",
    "1280x800-301",
    "1280x800-",
    1280,
  ]) {
    await assert.rejects(
      scrapeHtml({ token: "test", url: "https://example.com", screenshot }),
      /screenshot must be false, full, top/,
      String(screenshot),
    );
  }
  assert.equal(calls.length, accepted.length * 3);
});

test("invalid inputs fail before fetching", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return mockResponse("");
  };
  const options = { token: "test-token", url: "https://target.example" };
  for (const operation of [scrapeHtml, scrapeMarkdown, getScreenshot, scrapeJson]) {
    for (const timeout of [0, 331, 1.5, null]) {
      await assert.rejects(operation({ ...options, timeout }), /timeout/);
    }
    for (const maxAge of [-1, 604800001, 1.5, null]) {
      await assert.rejects(operation({ ...options, maxAge }), /max age/);
    }
    await assert.rejects(
      operation({ ...options, maxRetries: -1 }),
      /max retries/,
    );
    await assert.rejects(
      operation({ ...options, url: "file:///tmp/test" }),
      /HTTP/,
    );
    await assert.rejects(operation({ ...options, geoCode: "usa" }), /geo code/);
    for (const waitForSelector of [" ", "a".repeat(501)]) {
      await assert.rejects(
        operation({ ...options, waitForSelector }),
        /wait for selector/,
      );
    }
  }
  for (const operation of [scrapeHtml, scrapeMarkdown, scrapeJson]) {
    await assert.rejects(
      operation({ ...options, browserRendering: "true" }),
      /browserRendering must be a boolean/,
    );
    await assert.rejects(
      operation({ ...options, blockResources: 1 }),
      /blockResources must be a boolean/,
    );
  }
  for (const operation of [scrapeHtml, scrapeMarkdown]) {
    await assert.rejects(operation({ ...options, action: " " }), /action/);
  }
  await assert.rejects(scrapeJson({ ...options, prompt: " " }), /prompt/);
  await assert.rejects(
    scrapeJson({ ...options, html: "true" }),
    /html must be a boolean/,
  );
  await assert.rejects(
    scrapeJson({ ...options, screenshot: "full" }),
    /screenshot must be a boolean/,
  );
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
  for (const country of ["usa", "", "1a"]) {
    await assert.rejects(
      webSearch({ token: "test-token", query: "test", country }),
      /country/,
    );
  }
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
  // Scrape Brand takes only the URL; other options never reach the wire.
  await scrapeBrand({
    token: "test-token",
    url: "https://mrscraper.com/",
    bundle: "full",
    maxAge: 3600000,
    saveResult: false,
    timeout: 120,
    warmStart: true,
    geoCode: "GB",
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
      {
        action: "brand-scraping",
        url: "https://mrscraper.com/",
        bundle: "none",
      },
      {
        action: "websearch",
        query: "mrscraper",
        numResults: "10",
      },
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

test("warmStart is a boolean HTML, Markdown, and JSON control and preserves false", async () => {
  const calls = captureRequests();
  for (const operation of [scrapeHtml, scrapeMarkdown, scrapeJson]) {
    for (const warmStart of [false, true]) {
      await operation({ token: "test", url: "https://example.com", warmStart });
      assert.equal(calls.at(-1).query.warmStart, String(warmStart));
    }
    const sent = calls.length;
    for (const warmStart of ["true", 1, null]) {
      await assert.rejects(
        operation({ token: "test", url: "https://example.com", warmStart }),
        /warmStart must be a boolean/,
      );
    }
    assert.equal(calls.length, sent);
  }
  await getScreenshot({
    token: "test",
    url: "https://example.com",
    warmStart: true,
  });
  assert.ok(!("warmStart" in calls.at(-1).query));
});
