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
  getBrand,
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

test("page representations use GET and keep text bodies exact", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return mockResponse("Authorization: Bearer documentation-example");
  };
  const options = {
    token: "test-token",
    url: "https://target.example/?q=a&b=c",
  };
  const html = await scrapeHtml(options);
  await scrapeMarkdown(options);
  await getScreenshot({ ...options, area: "top", browserRendering: false });
  assert.equal(html.data, "Authorization: Bearer documentation-example");
  for (const { url, init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(url.origin, new URL(SCRAPER_API_BASE_URL).origin);
    assert.equal(url.searchParams.get("url"), options.url);
    assert.equal(url.searchParams.get("timeout"), "300");
  }
  assert.equal(calls[0].url.searchParams.get("html"), "true");
  assert.equal(calls[1].url.searchParams.get("html"), "false");
  assert.equal(calls[1].url.searchParams.get("markdown"), "true");
  assert.equal(calls[2].url.searchParams.get("screenshot"), "top");
  assert.equal(calls[2].url.searchParams.get("browserRendering"), "true");
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
  await assert.rejects(scrapeHtml({ ...options, tokenCap: 0 }), /token cap/);
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
  await assert.rejects(getScreenshot({ ...options, area: "invalid" }), /area/);
  await assert.rejects(scrapeJson({ ...options, prompt: " " }), /prompt/);
  await assert.rejects(
    scrapeBrand({ ...options, bundle: "invalid" }),
    /bundle/,
  );
  await assert.rejects(getBrand({ token: "test-token", jobId: " " }), /job ID/);
  await assert.rejects(
    getBrand({ token: "test-token", jobId: "job", output: "invalid" }),
    /output/,
  );
  for (const numResults of [0, 9, 101, 10.5]) {
    await assert.rejects(
      webSearch({ token: "test-token", query: "test", numResults }),
      /num results/,
    );
  }
  await assert.rejects(webSearch({ token: "test-token", query: " " }), /query/);
  await assert.rejects(
    webSearch({ token: "test-token", query: "test", country: "usa" }),
    /country/,
  );
  assert.equal(requests, 0);
});

test("network errors never echo the API key from the query string", async () => {
  globalThis.fetch = async (url) => {
    throw new Error(`connect ECONNREFUSED while requesting ${url}`);
  };
  const result = await scrapeHtml({
    token: "atk_networkerrorsecret1234",
    url: "https://target.example",
  });
  assert.equal(result.status_code, null);
  assert.doesNotMatch(result.error, /networkerrorsecret/);
});

test("JSON extraction uses a POST body for long prompts and preserves extracted fields", async () => {
  const prompt = "Extract all fields. Json Schema: " + "x".repeat(9000);
  globalThis.fetch = async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(init.method, "POST");
    assert.equal(params.has("prompt"), false);
    assert.equal(params.get("maxRetries"), "0");
    assert.equal(params.get("tokenCap"), "1");
    assert.deepEqual(JSON.parse(init.body), {
      url: "https://target.example",
      prompt,
      agent: "general",
    });
    return mockResponse(
      JSON.stringify({
        success: true,
        runtime: 1,
        data: { token: "extracted value" },
      }),
      200,
      "application/json",
    );
  };
  const result = await scrapeJson({
    token: "test-token",
    url: "https://target.example",
    prompt,
    maxRetries: 0,
    tokenCap: 1,
  });
  assert.equal(result.data.data.token, "extracted value");
});

test("brand creation and retrieval use their documented routes", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return mockResponse('{"data":{"job_id":"job-1"}}', 200, "application/json");
  };
  await scrapeBrand({
    token: "test-token",
    url: "https://target.example",
    bundle: "clean",
  });
  await getBrand({ token: "test-token", jobId: "job/&? 1", output: "html" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].url.searchParams.get("action"), "brand-scraping");
  assert.equal(calls[0].url.searchParams.get("bundle"), "clean");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: "https://target.example",
  });
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].url.pathname, "/neo/brand");
  assert.equal(calls[1].url.searchParams.get("id"), "job/&? 1");
  assert.equal(calls[1].url.searchParams.get("output"), "html");
});

test("web search matches the unified endpoint's JSON contract", async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, SCRAPER_API_BASE_URL);
    assert.equal(init.method, "POST");
    bodies.push(JSON.parse(init.body));
    return mockResponse('{"success":true}', 200, "application/json");
  };
  await webSearch({ token: "test-token", query: "mrscraper" });
  await webSearch({
    token: "test-token",
    query: "e-menessaptieka.lv linkedin",
    country: "ID",
    numResults: 100,
    timeout: 5,
  });
  assert.deepEqual(bodies, [
    { action: "websearch", query: "mrscraper", country: "us", numResults: 10 },
    {
      action: "websearch",
      query: "e-menessaptieka.lv linkedin",
      country: "id",
      numResults: 100,
    },
  ]);
});

test("the public package exports the six operations and brand retrieval", async () => {
  const exports = await import("../lib/index.js");
  for (const name of [
    "scrapeHtml",
    "scrapeMarkdown",
    "getScreenshot",
    "scrapeBrand",
    "getBrand",
    "scrapeJson",
    "webSearch",
    "getSubscriptionAccountApi",
  ]) {
    assert.equal(typeof exports[name], "function", name);
  }
  assert.equal(exports.scraperApi, undefined);
  assert.equal(exports.webSearchApi, undefined);
});
