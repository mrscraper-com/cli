---
name: mrscraper-fetch
description: |
  Fetch unchanged HTML from a known URL with one MrScraper CLI request, optionally sending the API's browserRendering, geoCode, selector-wait, homepage, resource-blocking, retry, token-cap, and timeout parameters. Use when the user provides a URL and wants page content to read, summarize, cite, inspect, or archive, including JavaScript-rendered or geo-sensitive pages. Do not use for requested fields or structured records; use mrscraper-scrape. Do not use for query-first discovery; use mrscraper-serp.
---

# Fetch Page HTML with MrScraper

Use `fetch` for a known URL when the page itself is needed. For installation,
authentication, or command routing, use [mrscraper](../mrscraper/SKILL.md).

## Fetch Once

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://example.com" > ./.mrscraper/example-fetch.json
```

The command makes one `GET https://api.mrscraper.com/` request. Stdout is a
CLI-created JSON envelope; `.data` is the endpoint's unchanged HTML:

```bash
mrscraper fetch "https://example.com" | jq -r '.data'
```

Do not expect Markdown or page-document JSON. Fetch has no `--format` option and
does not locally parse or convert HTML.

## Send Browser Controls Explicitly

Use the backend's browser renderer only when JavaScript or dynamic content is
required:

```bash
mrscraper fetch "https://example.com" --browser-rendering
```

Wait for a CSS selector only with explicit browser rendering:

```bash
mrscraper fetch "https://example.com/products" \
  --browser-rendering \
  --wait-for-selector ".product-card"
```

The CLI does not detect block pages or escalate automatically. If a direct
request is blocked or incomplete, inspect that result, then make one explicit
browser-rendered retry. Do not blind-retry.

Add only API parameters the target requires:

```bash
# Route through Indonesia
mrscraper fetch "https://example.com" --browser-rendering --geo-code ID

# Establish site cookies from the home page first
mrscraper fetch "https://example.com/product" \
  --browser-rendering --home-page

# Bound backend retries and token use
mrscraper fetch "https://example.com" \
  --browser-rendering --block-resources --max-retries 3 --token-cap 10000
```

Parameter mapping is direct:

- `--browser-rendering` → `browserRendering=true`
- `--geo-code` → `geoCode`
- `--wait-for-selector` → `waitForSelector`
- `--home-page` → `homePage=true`
- `--block-resources` → `blockResources=true`
- `--max-retries` → `maxRetries`
- `--token-cap` → `tokenCap`
- `--timeout` → the API page-load `timeout`; the CLI transport allows 30 extra seconds

## Handle Results

- Preserve the JSON envelope when diagnostics or response headers matter.
- Extract `.data` when only HTML is needed.
- Check the exit code before trusting the body.
- Treat `--wait-for-selector` as a CSS selector, not a duration.
- Do not claim browser rendering supports clicks, forms, login, or an
  interactive session.
- Use [mrscraper-scrape](../mrscraper-scrape/SKILL.md) for requested fields or
  records and [mrscraper-serp](../mrscraper-serp/SKILL.md) for discovery.

Keep `./.mrscraper/` out of version control unless the user asks to commit it.
