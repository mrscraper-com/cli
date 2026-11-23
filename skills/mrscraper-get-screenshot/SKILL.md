---
name: mrscraper-get-screenshot
description: Capture a full-page PNG screenshot of a known public URL with the MrScraper CLI's get-screenshot command. Use for visual checks, archiving, previews, or debugging what a page shows; the page always renders in a real browser.
---

# Get a Screenshot with MrScraper

`mrscraper get-screenshot <url>` captures the full scrollable page as a base64
PNG. It sends `GET https://api.mrscraper.com` with `screenshot=full` and
`browserRendering=true` added automatically, so there is no screenshot area or
rendering option to pass. See [mrscraper](../mrscraper/SKILL.md) for
installation, authentication, and account status.

Use public content the user is authorized to access. The browser loads the
page; it does not click controls, submit forms, or sign in.

## Capture and Save a Screenshot

```bash
mkdir -p ./.mrscraper
mrscraper get-screenshot "https://example.com" > ./.mrscraper/screenshot.json
jq -r '.data.screenshot' ./.mrscraper/screenshot.json \
  | base64 --decode > ./.mrscraper/page.png
mrscraper get-screenshot "https://example.com" \
  --wait-for-selector '#results' --geo-code de --timeout 120 \
  > ./.mrscraper/results.json
```

The CLI prints a JSON envelope. The base64 PNG is in `data.screenshot` and the
page HTML is in `data.html`. Decode the screenshot before viewing it, and
avoid printing the base64 text into a conversation.

For a first-viewport or custom-size image, use
[mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) with
`--screenshot top` or `--screenshot 1280x800`.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<url>` | Required | `url`, an absolute HTTP or HTTPS URL. |
| `--timeout SECONDS` | `300` | `timeout`, 1–330. The HTTP request allows 30 more seconds. |
| `--wait-for-selector SELECTOR` | Omitted | `waitForSelector`: CSS selector or text to wait for, up to 500 characters. |
| `--geo-code CODE` | Omitted | `geoCode`: two-letter country to load the page from. The API uses the United States when omitted. |
| `--save-result` / `--no-save-result` | Saved | `saveResult`: save the result to the dashboard Result tab. |
| `--max-age MILLISECONDS` | `0` | `maxAge`: return a cached result of the same request when it is newer than this age, up to 604800000 (7 days). A cached result costs the same tokens as the original scrape. `0` always captures fresh. |
| `--token-cap TOKENS` | Omitted | `tokenCap`: positive cap on tokens for the capture and its retries. Omit for no limit. |
| `--max-retries N` | Omitted | `maxRetries`: nonnegative retry limit. Omit for no limit. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

## Inspect and Continue

Check the exit status, `status_code`, and that `data.screenshot` is present
before decoding. Tokens used appear in `headers.token_usage`. If dynamic
content is missing from the image, wait for a selector that marks it as
loaded, or increase the timeout. Report the saved image path rather than the
encoded data.

The command follows the [Get Screenshot reference](https://docs.mrscraper.com/docs/api/scraper-api/get-screenshot).
