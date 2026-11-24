---
name: mrscraper-get-screenshot
description: Capture a PNG screenshot of a known public URL with the MrScraper CLI's get-screenshot command, as the full page, the first viewport, or a custom viewport. Use for visual checks, archiving, previews, or debugging what a page shows; the page always renders in a real browser.
---

# Get a Screenshot with MrScraper

`mrscraper get-screenshot <url>` captures a base64 PNG of the full scrollable
page by default. Pass `--screenshot top` for the first viewport, or a
`WIDTHxHEIGHT` viewport with an optional `-ZOOM` percent, such as
`--screenshot 1280x800` or `--screenshot 1920x1080-75`. It sends
`GET https://api.mrscraper.com` with `browserRendering=true`, `html=false`,
`markdown=false`, and `saveResult=true` added automatically, so there is no
rendering or output option to pass; results are always saved to the dashboard
Result tab. See [mrscraper](../mrscraper/SKILL.md) for installation,
authentication, and account status.

Use public content the user is authorized to access. The browser loads the
page; it does not click controls, submit forms, or sign in.

## Capture and Save a Screenshot

```bash
mkdir -p ./.mrscraper
mrscraper get-screenshot "https://example.com" > ./.mrscraper/screenshot.json
jq -r '.data.screenshot' ./.mrscraper/screenshot.json \
  | base64 --decode > ./.mrscraper/page.png
mrscraper get-screenshot "https://example.com" --screenshot top \
  > ./.mrscraper/top.json
mrscraper get-screenshot "https://example.com" --screenshot 1280x800 \
  --wait-for-selector '#results' --geo-code de --timeout 120 \
  > ./.mrscraper/results.json
```

The CLI prints a JSON envelope. The base64 PNG is in `data.screenshot`, and
the API still includes the page HTML in `data.html` even though `html=false`
is sent. Decode the screenshot before viewing it, and
avoid printing the base64 text into a conversation.

To get the page HTML together with a screenshot, use
[mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) with
`--screenshot`.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<url>` | Required | `url`, an absolute HTTP or HTTPS URL. |
| `--screenshot AREA` | `full` | `screenshot`: `full` for the entire scroll height, `top` for the first viewport, or `WIDTHxHEIGHT` (100–3840 pixels) with an optional `-ZOOM` (25–300), such as `1280x800` or `1920x1080-75`. |
| `--timeout SECONDS` | `300` | `timeout`, 1–330. The HTTP request allows 30 more seconds. |
| `--wait-for-selector SELECTOR` | Omitted | `waitForSelector`: CSS selector or text to wait for, up to 500 characters. |
| `--geo-code CODE` | Omitted | `geoCode`: two-letter country to load the page from. The API uses the United States when omitted. |
| `--max-age MILLISECONDS` | `0` | `maxAge`: return a cached result of the same request when it is newer than this age, up to 604800000 (7 days). A cached result costs the same tokens as the original scrape. `0` always captures fresh. |
| `--max-retries N` | Omitted | `maxRetries`: nonnegative retry limit. Omit for no limit. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

## Inspect and Continue

Check the exit status, `status_code`, and that `data.screenshot` is present
before decoding. Tokens used appear in `headers.token_usage`. If dynamic
content is missing from the image, wait for a selector that marks it as
loaded, or increase the timeout. Report the saved image path rather than the
encoded data.

The command follows the [Get Screenshot reference](https://docs.mrscraper.com/docs/api/scraper-api/get-screenshot).
