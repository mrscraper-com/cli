---
name: mrscraper-fetch
description: |
  Fetch page HTML from a known URL through MrScraper's Web Unblocker, with optional browser rendering, geographic routing, selector waits, homepage navigation, resource blocking, retries, token limits, and page-load timeouts. Use when the user provides a URL and wants to read, summarize, cite, inspect, or archive the page, including protected, JavaScript-rendered, or geo-sensitive content. Use mrscraper-scrape for requested fields or structured records, and mrscraper-serp when no target URL is known.
---

# Fetch Page Content with MrScraper

Use `fetch` when the user already has a URL and needs the content of that page.
Use [mrscraper](../mrscraper/SKILL.md) for installation, authentication, saved
runs, account status, or command routing.

## Web Unblocker Context

`fetch` uses MrScraper's
[Web Unblocker](https://docs.mrscraper.com/docs/features/unblocker) to retrieve
HTML from public or protected pages. Browser rendering executes page
JavaScript, geographic routing selects a country proxy, selector waits allow
delayed content to appear, and homepage navigation establishes a normal
navigation path before loading the target.

Start with the default request and add only the page-loading controls the target
needs. Unblocker plan-token usage is based on runtime and bandwidth: one token
per 30 seconds and one token per 0.2 MB, rounded up per component. Resource
blocking can reduce bandwidth for text-focused pages. Retries stop when the
request succeeds, the retry limit is reached, or the running token total reaches
the token cap. The initial request always runs, even when it exceeds the cap.
See the [Token Plan](https://docs.mrscraper.com/docs/getting-started/api-token)
for the complete calculation.

## Step 1 — Define the Outcome

Confirm the target URL and what the user wants from it:

- Read, summarize, cite, or inspect the page;
- Check whether specific text appears;
- Archive the response; or
- Load JavaScript-rendered or geo-sensitive content.

Use [mrscraper-scrape](../mrscraper-scrape/SKILL.md) when the requested outcome
is a structured record or set of fields. Use
[mrscraper-serp](../mrscraper-serp/SKILL.md) when discovery must happen first.

## Step 2 — Run the Fetch

The command sends `GET https://api.mrscraper.com/` with the target URL and
selected page-loading options.

Save substantial responses inside the user's current project:

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://example.com" > ./.mrscraper/example-fetch.json
```

Stdout contains a JSON envelope:

```json
{
  "status_code": 200,
  "data": "<html>...</html>",
  "headers": {
    "content-type": "text/html"
  }
}
```

Extract the HTML when only the page body is needed:

```bash
mrscraper fetch "https://example.com" | jq -r '.data'
```

Check the exit code before using the result. Progress and diagnostics appear on
stderr, so redirected stdout remains machine-readable.

## Step 3 — Choose Page-Loading Options

Use browser rendering when the page depends on JavaScript:

```bash
mrscraper fetch "https://example.com/products" --browser-rendering
```

Wait for a CSS selector when the required content appears later:

```bash
mrscraper fetch "https://example.com/products" \
  --browser-rendering \
  --wait-for-selector ".product-card"
```

Use geographic routing or homepage navigation when the target requires it:

```bash
mrscraper fetch "https://example.com/product" \
  --browser-rendering \
  --geo-code ID \
  --home-page
```

Bound resource use for a browser-rendered page:

```bash
mrscraper fetch "https://example.com" \
  --browser-rendering \
  --block-resources \
  --max-retries 3 \
  --token-cap 10000 \
  --timeout 60
```

### Parameters

| CLI parameter | Default | Request mapping | Use |
| --- | --- | --- | --- |
| `<url>` | required | Query `url` | Target page URL. |
| `--browser-rendering` | `false` | Query `browserRendering=true` | Load the page in a browser and execute JavaScript. |
| `--geo-code <code>` | omitted | Query `geoCode` | Route the request through an ISO 3166-1 alpha-2 country. |
| `--wait-for-selector <selector>` | omitted | Query `waitForSelector` | Wait for a CSS selector; include `--browser-rendering`. |
| `--home-page` | `false` | Query `homePage=true` | Visit the site root before loading the target page. |
| `--block-resources` | `false` | Query `blockResources=true` | Block non-essential browser resources when supported by the selected proxy. |
| `--max-retries <n>` | `3` | Query `maxRetries` | Set the maximum retry attempts after a failed request; zero is accepted. |
| `--token-cap <n>` | omitted | Query `tokenCap` | Limit the running plan-token total used to decide whether another retry may run; the initial request always runs. |
| `--timeout <seconds>` | `30` | Query `timeout` | Set the page-load timeout; the command allows another 30 seconds to receive the response. |
| `--token <key>` | configured credential | Request headers | Override authentication for this command. |

## Step 4 — Inspect and Retry Deliberately

Start with the simplest command that can load the page. If the response is
blocked, incomplete, or missing dynamic content:

1. Inspect `status_code`, `data`, and relevant response headers;
2. Add `--browser-rendering`;
3. Add `--wait-for-selector`, `--geo-code`, or `--home-page` only when the
   target requires it; and
4. Run one revised command and inspect that result before trying again.

Treat `--wait-for-selector` as a CSS selector, not a duration. Browser
rendering loads a page; it does not click controls, submit forms, or provide an
authenticated interactive browser session.

## Step 5 — Deliver the Result

Answer the user's request from the fetched page and report any saved artifact.
Keep the full envelope when headers or diagnostics matter. For ordinary reading
or summarization, use the HTML in `.data` and present the requested answer in
chat.
