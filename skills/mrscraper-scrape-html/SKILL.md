---
name: mrscraper-scrape-html
description: Retrieve the raw HTML of a known public URL with the MrScraper CLI's scrape-html command. Use when a parser, archive, or audit needs page markup; supports browser rendering, geography, selectors, caching, token caps, retries, and an optional screenshot.
---

# Scrape HTML with MrScraper

`mrscraper scrape-html <url>` returns the page's raw HTML. It sends
`GET https://api.mrscraper.com` with `html=true`, `markdown=false`, and
`saveResult=true` added automatically, so there is no option for them; results
are always saved to the dashboard Result tab. A screenshot is optional; setting
`--screenshot` also sends `browserRendering=true`, because a screenshot needs a
rendered page. See [mrscraper](../mrscraper/SKILL.md) for installation,
authentication, and account status. Use
[mrscraper-web-search](../mrscraper-web-search/SKILL.md) when no URL is known.

Use public content the user is authorized to access. Browser rendering loads
pages; it does not click controls, submit forms, or provide an authenticated
interactive browser session.

## Retrieve and Save HTML

```bash
mkdir -p ./.mrscraper
mrscraper scrape-html "https://example.com" > ./.mrscraper/page.json
jq -r '.data' ./.mrscraper/page.json > ./.mrscraper/page.html
mrscraper scrape-html "https://example.com" \
  --browser-rendering --wait-for-selector '.products' --geo-code gb \
  --max-retries 1 --timeout 120 > ./.mrscraper/products.json
```

The CLI prints a JSON envelope. `data` is the HTML string. With
`--screenshot`, the API returns JSON instead: the HTML is in `data.html` and a
base64 image is in `data.screenshot`. The API reference documents PNG, but a
JPEG has also been returned, so check the first bytes before naming the file.

```bash
mrscraper scrape-html "https://example.com" --screenshot top \
  > ./.mrscraper/page-with-screenshot.json
jq -r '.data.screenshot' ./.mrscraper/page-with-screenshot.json \
  | base64 --decode > ./.mrscraper/page-screenshot
file ./.mrscraper/page-screenshot
```

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
| `--screenshot CAPTURE` | `false` | `screenshot`: `full`, `top`, or `WIDTHxHEIGHT` (100–3840 pixels) with an optional `-ZOOM` (25–300), such as `1280x800` or `1920x1080-75`. Setting a screenshot also sends `browserRendering=true`, even with `--no-browser-rendering`. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

`--wait-for-selector` needs a rendered page, so do not combine it with
`--no-browser-rendering`; the API rejects that pair without charging tokens.

## Inspect and Continue

Check the exit status, `status_code`, and the target page's
`headers["x-status-code"]` before using the HTML. Tokens used appear in
`headers.token_usage`. Progress and diagnostics use stderr; stdout stays JSON.

If content is missing, adjust rendering, a selector, warm start, or geography
based on the evidence. Do not repeat an identical failing request. Parse the
saved HTML locally, and use
[mrscraper-scrape-json](../mrscraper-scrape-json/SKILL.md) when AI
extraction is simpler than writing a parser.

The command follows the [Scrape HTML reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html).
