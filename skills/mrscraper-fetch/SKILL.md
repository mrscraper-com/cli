---
name: mrscraper-fetch
description: Retrieve a known public URL with the MrScraper CLI as HTML, Markdown, a screenshot, brand data, or structured JSON. Use for reading, summarizing, archiving, or extracting a page; supports browser rendering, geography, selectors, and retry budgets. Use web search when no URL is known.
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
| `scrape-markdown URL` | Clean Markdown string in `data`. |
| `get-screenshot URL` | JSON with base64 `data.screenshot`; HTML included by default. |
| `scrape-json URL --prompt TEXT` | API JSON with extracted fields in `data.data`. |
| `scrape-brand URL` | Brand in `data.data.brand`, job ID in `data.data.job_id`. |

Save substantial responses in the current project:

```bash
mkdir -p ./.mrscraper
mrscraper scrape-html "https://books.toscrape.com/" > ./.mrscraper/page.json
mrscraper scrape-markdown "https://books.toscrape.com/" | jq -r '.data'
mrscraper get-screenshot "https://example.com" --area full --no-html \
  > ./.mrscraper/screenshot.json
jq -r '.data.screenshot' ./.mrscraper/screenshot.json \
  | base64 --decode > ./.mrscraper/page.jpg
mrscraper scrape-json "https://books.toscrape.com/" \
  --prompt 'Extract book titles and prices' --no-html > ./.mrscraper/books.json
```

`--area` accepts `full` (default) or `top`. Screenshots always enable browser
rendering. Scrape JSON uses the `general` agent and sends the prompt in a POST
body so long prompts fit. Append `Json Schema:` and a schema to constrain
extraction. The prompt parses content; it does not control navigation.

## Page Loading and Budgets

HTML, Markdown, screenshot, and JSON commands share these options:

| Option | Behavior |
| --- | --- |
| `--browser-rendering` / `--no-browser-rendering` | Enable or disable Chromium; omit to use the API default. Screenshots require rendering. |
| `--super` / `--no-super` | Enable real-device routing (API default) or standard routing. |
| `--wait-until EVENT` | `domcontentloaded`, `load`, `networkidle0`, or `networkidle2`. |
| `--wait-for-selector SELECTOR` | Wait for delayed content. |
| `--geo-code CODE` / `--proxy-country CODE` | Select page or proxy geography. |
| `--proxy URL` | Use a custom proxy. |
| `--block-resources` | Skip images, fonts, and stylesheets. Avoid when visual assets matter. |
| `--return-cookie` | Include browser session cookies. |
| `--no-save-result` | Do not save the result to the dashboard. |
| `--max-retries N` | Nonnegative retry limit; zero disables retries. |
| `--token-cap N` | Positive total token budget, including retries. |
| `--timeout SECONDS` | Page timeout 1–300, default 300; transport allows 30 more seconds. |
| `--token KEY` | Override configured authentication. |

```bash
mrscraper scrape-markdown "https://example.com" \
  --browser-rendering --wait-for-selector '.products' --geo-code ID \
  --max-retries 1 --token-cap 10 --timeout 60
```

## Brand Jobs and Artifacts

```bash
mrscraper scrape-brand "https://example.com" --bundle clean > ./.mrscraper/brand.json
mrscraper scrape-brand --job-id JOB_ID
mrscraper scrape-brand --job-id JOB_ID --output html | jq -r '.data' > ./.mrscraper/brand.html
mrscraper scrape-brand --job-id JOB_ID --output bundle \
  | jq -r '.data.base64' | base64 --decode > ./.mrscraper/brand.zip
```

`--bundle none` (default) returns brand JSON; `clean` adds page files without
scripts; `full` keeps scripts in the bundle. Bundled requests can take about a
minute. `--timeout` sets the local deadline (default 300 seconds).

Retrieve an existing job with `--job-id`, exclusively of a URL. `--output`
requires `--job-id` and accepts `html`, `bundle`, `screenshot`, or
`screenshot_full`. Jobs created with `bundle=none` only have HTML available.
Binary artifacts are preserved as `data.base64` with `data.encoding=base64`.

## Inspect and Continue

Check exit status, `status_code`, API `success`/`error`, and the target page's
`headers["x-status-code"]` before using results. Plan tokens used appear in
`headers.token_usage`. Progress and diagnostics use stderr; stdout stays JSON.

If content is incomplete, adjust rendering, a selector, or geography based on
the evidence. Do not repeat an identical failing request. Preserve successful
responses for later analysis and report saved artifacts. For many similar
pages, inspect representatives and reuse one extraction implementation.

The commands follow the [Scraper API reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html).
