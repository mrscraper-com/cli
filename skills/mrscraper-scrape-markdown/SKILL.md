---
name: mrscraper-scrape-markdown
description: Convert a known public URL into clean Markdown with the MrScraper CLI's scrape-markdown command. Use for reading, summarizing, quoting, or feeding page text to an LLM or RAG pipeline; supports browser rendering, geography, selectors, caching, token caps, and retries.
---

# Scrape Markdown with MrScraper

`mrscraper scrape-markdown <url>` returns the page as clean Markdown, without
navigation, scripts, or ads. It sends `GET https://api.mrscraper.com` with
`markdown=true`, `html=false`, `screenshot=false`, and `saveResult=true` added
automatically, so there is no option for them; results are always saved to the
dashboard Result tab.
See [mrscraper](../mrscraper/SKILL.md) for installation, authentication, and
account status. Use [mrscraper-web-search](../mrscraper-web-search/SKILL.md)
when no URL is known.

Use public content the user is authorized to access. Browser rendering loads
pages; it does not click controls, submit forms, or provide an authenticated
interactive browser session.

## Retrieve and Save Markdown

```bash
mkdir -p ./.mrscraper
mrscraper scrape-markdown "https://example.com" > ./.mrscraper/page.json
jq -r '.data' ./.mrscraper/page.json > ./.mrscraper/page.md
mrscraper scrape-markdown "https://example.com/docs" \
  --browser-rendering --wait-for-selector 'main' --max-age 86400000 \
  > ./.mrscraper/docs.json
```

The CLI prints a JSON envelope. `data` is the Markdown string, typically much
smaller than the page HTML. Use
[mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) when the page
structure matters.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<url>` | Required | `url`, an absolute HTTP or HTTPS URL. |
| `--browser-rendering` / `--no-browser-rendering` | Omitted | `browserRendering`. Omitted loads without a browser first and switches to one automatically if blocked; `true` always renders and `false` never does. |
| `--timeout SECONDS` | `300` | `timeout`, 1–330. The HTTP request allows 30 more seconds. |
| `--warm-start` | Off | `warmStart`: open the site's home page first to warm the session. |
| `--block-resources` | Off | `blockResources`: skip images, fonts, and stylesheets. |
| `--wait-for-selector SELECTOR` | Omitted | `waitForSelector`: CSS selector or text to wait for, up to 500 characters. |
| `--action NAME` | Omitted | `action`: route the request to a scraper action or flag it for analytics. |
| `--geo-code CODE` | Omitted | `geoCode`: two-letter country to load the page from. The API uses the United States when omitted. |
| `--max-age MILLISECONDS` | `0` | `maxAge`: return a cached result of the same request when it is newer than this age, up to 604800000 (7 days). A cached result costs the same tokens as the original scrape. `0` always scrapes fresh. |
| `--max-retries N` | Omitted | `maxRetries`: nonnegative retry limit. Omit for no limit. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

`--wait-for-selector` needs a rendered page, so do not combine it with
`--no-browser-rendering`; the API rejects that pair without charging tokens.

## Inspect and Continue

Check the exit status, `status_code`, and the target page's
`headers["x-status-code"]` before using the text. Tokens used appear in
`headers.token_usage`. Progress and diagnostics use stderr; stdout stays JSON.

If the Markdown is incomplete, try `--browser-rendering`, a selector, warm
start, or another country based on the evidence. Do not repeat an identical
failing request. Preserve successful responses for later questions, and use
[mrscraper-scrape-json](../mrscraper-scrape-json/SKILL.md) when named fields
are needed.

The command follows the [Scrape Markdown reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-markdown).
