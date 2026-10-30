---
name: mrscraper-scraper-api
description: Fetch a public web page as HTML, Markdown, or a screenshot with format-specific MrScraper services. Extract structured data across pages, discover site URLs, and create or read brand assets.
---

# Scraping services

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
Choose the service for the requested task; the shared transport is internal.

| Command | Purpose |
| --- | --- |
| `scraperHtml` | Fetch a public web page as HTML. |
| `scraperMarkdown` | Fetch a public web page as Markdown for reading and analysis. |
| `getScreenshot` | Capture a browser-rendered page as an image. |
| `scraperJson` | Extract structured data from one page using a prompt. |
| `scraperMultiplePage` | Extract listing entries across multiple pages. |
| `scraperSitemap` | Discover site URLs with optional include and exclude patterns. |
| `scrapeBrand` | Start a job to extract brand assets. |
| `getBrand` | Read a brand job or download its available output. |

```bash
mrscraper scraperHtml "https://books.toscrape.com/"
mrscraper scraperMarkdown "https://books.toscrape.com/" --home-page
mrscraper getScreenshot "https://books.toscrape.com/" --save ./.mrscraper/page.png
mrscraper scraperJson "https://books.toscrape.com/" --prompt "Extract all book titles and prices."
mrscraper scraperMultiplePage "https://books.toscrape.com/" --max-pages 3
mrscraper scraperSitemap "https://docs.mrscraper.com" --max-depth 2 --limit 1000 --include-patterns '/docs/*' --exclude-patterns '/private/*'
mrscraper scrapeBrand "https://www.brooksrunning.com" --bundle clean
mrscraper getBrand "<job_id>"
mrscraper getBrand "<job_id>" --output bundle --save ./.mrscraper/brand.zip
```

HTML and Markdown commands select their own output format. JSON extraction
accepts `--prompt` to describe the data to extract. Listing extraction defaults
to `--max-pages 3`. Sitemap discovery defaults to `--max-depth 2`,
`--max-pages 3`, and `--limit 1000`; optional include/exclude pattern strings
are preserved unchanged. The CLI also accepts
the Python SDK's snake-case names for all eight commands.

Screenshots use browser rendering, full-page capture, readiness
`domcontentloaded`, and timeout 300. `--no-full-page` captures the viewport.
Other initial scraping services default to timeout 120, geolocation `US`,
and the API's default browser rendering policy. `--super` enables real-device routing.
Brand bundles are `clean` (default), `full`, or `none`. Read the returned job ID
with `getBrand`; output options are `html`, `bundle`, `screenshot`, and
`screenshot_full`. Brand reads default to timeout 600. Each `getBrand` call
makes one request; repeat it to check a job that is still processing.

Shared options include `--geo-code`, `--proxy-country`, `--proxy`,
`--no-use-proxy`, `--wait-for-selector`, `--wait-until`, `--home-page`,
`--block-resources`, `--bypass-proxy`, `--cookie-jar`, `--headers <json>`,
`--stream`, `--no-stream`, and `--discard-token-secret`. Browser policy can be
set with `--browser-rendering` or `--no-browser-rendering` for services other
than screenshots. `--max-retries` defaults to 3; `--token-cap` is omitted;
both accept zero. Page timeouts must be 1–300 seconds.

The response is `{ status_code, data, headers }`. Binary images and ZIP files
appear as `{ encoding: "base64", content, byte_length }` in JSON stdout. Use
`--save <path>` to write `data` directly and preserve binary bytes; parent
directories are created automatically. Text responses are saved as text and
JSON metadata responses as JSON. A successful save adds `saved_to` to stdout.
Inspect the content type and data before treating a response as a completed
download, especially while a brand job is still processing. Save source content
when subsequent local extraction needs it. Use account status to check quota
before a large job.
