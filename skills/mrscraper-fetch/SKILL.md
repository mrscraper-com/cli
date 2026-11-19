---
name: mrscraper-fetch
description: Retrieve a known public URL with the MrScraper CLI as HTML, Markdown, a screenshot, brand data, or structured JSON. Use for reading, summarizing, archiving, or extracting a page; supports browser rendering, geography, selectors, and retry limits. Use web search when no URL is known.
---

# Retrieve Page Content with MrScraper

Use the command that matches the requested representation. See
[mrscraper](../mrscraper/SKILL.md) for installation, authentication, and account
status, or [mrscraper-serp](../mrscraper-serp/SKILL.md) for query-first discovery.

Use public content the user is authorized to access. Browser rendering loads
pages; it does not click controls, submit forms, or provide an authenticated
interactive browser session.

## Choose a Representation

| Command | Output in the CLI envelope |
| --- | --- |
| `scrape-html URL` | Raw HTML string in `data`. |
| `scrape-markdown URL` | Clean Markdown string in `data`; `--html` renders the page and returns `data.html` and `data.markdown`. |
| `get-screenshot URL` | JSON with base64 `data.screenshot` and the page HTML in `data.html`. |
| `scrape-json URL --prompt TEXT` | API JSON with extracted fields in `data.data`. |
| `scrape-brand URL` | Brand in `data.data.brand`, job ID in `data.data.job_id`. |

Save substantial responses in the current project:

```bash
mkdir -p ./.mrscraper
mrscraper scrape-html "https://example.com" > ./.mrscraper/page.json
mrscraper scrape-markdown "https://example.com" | jq -r '.data'
mrscraper get-screenshot "https://example.com" --screenshot full --no-html \
  > ./.mrscraper/screenshot.json
jq -r '.data.screenshot' ./.mrscraper/screenshot.json \
  | base64 --decode > ./.mrscraper/page.png
mrscraper scrape-json "https://example.com" \
  --prompt 'Extract book titles and prices' > ./.mrscraper/books.json
mrscraper scrape-brand "https://mrscraper.com/" > ./.mrscraper/brand.json
```

`--screenshot` accepts `full` (default) or `top`. Screenshots always render
in a browser; add `--markdown` to also return Markdown. Scrape JSON uses the
`general` agent; add `--html` or `--screenshot` to include the page HTML or a
screenshot. Append `Json Schema:` and a schema to the prompt to constrain
extraction; long prompts are sent in a POST body automatically. The prompt
parses content; it does not control navigation.

Scrape Brand returns brand JSON only. Page bundles are not available. HTTP 422
with a settled job means the page has no usable brand data; it is not charged.

## Page Loading and Retries

HTML, Markdown, screenshot, and JSON commands share these options:

| Option | Behavior |
| --- | --- |
| `--browser-rendering` | Render in a browser. Off by default; not on `get-screenshot`, which always renders. |
| `--super` | Route through real devices. Off by default. |
| `--wait-until EVENT` | `domcontentloaded` (default), `load`, `networkidle0`, or `networkidle2`. |
| `--wait-for-selector SELECTOR` | Wait for delayed content. Not on `scrape-json`. |
| `--block-resources` | Skip images, fonts, and stylesheets. Not on `scrape-json`; avoid when visual assets matter. |
| `--return-cookie` | Include browser session cookies. Not on `scrape-json`. |
| `--geo-code CODE` / `--proxy-country CODE` | Two-letter page or proxy country; default `us`. |
| `--proxy URL` | Use a custom proxy. |
| `--max-retries N` | Nonnegative retry limit; zero disables retries. Omit for no limit. |
| `--save-result` | Save the result to the dashboard. Off by default. |
| `--timeout SECONDS` | Page timeout 1–300, default 300; transport allows 30 more seconds. |
| `--token KEY` | Override configured authentication. |

HTML and Markdown also support `--warm-start`, which defaults to off:

| Option | Behavior |
| --- | --- |
| `--warm-start` | Whether to enable warm start for more reliable scraping, at the cost of additional latency. |

```bash
mrscraper scrape-markdown "https://example.com" \
  --browser-rendering --wait-for-selector '.products' --geo-code id \
  --max-retries 1 --timeout 60
```

## Inspect and Continue

Check exit status, `status_code`, API `success`/`error`, and the target page's
`headers["x-status-code"]` before using results. Plan tokens used appear in
`headers.token_usage`. Progress and diagnostics use stderr; stdout stays JSON.

If content is incomplete, adjust rendering, Super routing, a selector, or
geography based on the evidence. Do not repeat an identical failing request.
Preserve successful responses for later analysis and report saved artifacts.
For many similar pages, inspect representatives and reuse one extraction
implementation.

The commands follow the [Scraper API reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html).
