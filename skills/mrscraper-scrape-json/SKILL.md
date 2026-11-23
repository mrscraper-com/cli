---
name: mrscraper-scrape-json
description: Extract structured JSON from a known public URL with the MrScraper CLI's scrape-json command and a natural-language prompt, optionally shaped by a JSON schema. Use for product, article, listing, or profile fields from one page without writing selectors.
---

# Scrape JSON with MrScraper

`mrscraper scrape-json <url> --prompt TEXT` extracts structured data from one
page with MrScraper's `general` AI agent. It sends `agent=general`
automatically. See [mrscraper](../mrscraper/SKILL.md) for installation,
authentication, and account status.

The prompt only parses the scraped content; it cannot click, scroll, or
navigate. Use public content the user is authorized to access.

## Extract and Save JSON

```bash
mkdir -p ./.mrscraper
mrscraper scrape-json "https://books.toscrape.com/" \
  --prompt 'Extract the first 5 books with title and price' \
  --no-html > ./.mrscraper/books.json
jq '.data.data' ./.mrscraper/books.json
```

Append `Json Schema:` and a schema to the prompt to constrain the output:

```bash
mrscraper scrape-json "https://books.toscrape.com/" --no-html \
  --prompt 'Extract the first 2 books. Json Schema: {"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"string"}},"required":["title","price"]}}' \
  > ./.mrscraper/books-schema.json
```

The request is a GET with every field in the query string. When the encoded
URL would exceed 8,000 characters, the CLI switches to POST with `url`,
`prompt`, and `agent` in a JSON body and the other options in the query.

The CLI prints a JSON envelope. Extracted fields are in `data.data`; the run
also reports `data.success`, `data.token_usage`, `data.status`, and
`data.error`. The page HTML is in `data.html` unless `--no-html` is passed.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<url>` | Required | `url`, an absolute HTTP or HTTPS URL. |
| `--prompt TEXT` | `Extract all data as complete as possible.` | `prompt`: the data to extract, optionally followed by `Json Schema:` and a schema. |
| `--html` / `--no-html` | Included | `html`: include the page HTML in the response. Pass `--no-html` for a smaller response. |
| `--browser-rendering` / `--no-browser-rendering` | Omitted | `browserRendering`. Omitted loads without a browser first and switches to one automatically if blocked; `true` always renders and `false` never does. |
| `--timeout SECONDS` | `300` | `timeout`, 1–330. The HTTP request allows 30 more seconds. |
| `--warm-start` | Off | `warmStart`: open the site's home page first to warm the session. |
| `--block-resources` | Off | `blockResources`: skip images, fonts, and stylesheets. |
| `--wait-for-selector SELECTOR` | Omitted | `waitForSelector`: CSS selector or text to wait for, up to 500 characters. |
| `--geo-code CODE` | Omitted | `geoCode`: two-letter country to load the page from. The API uses the United States when omitted. |
| `--save-result` / `--no-save-result` | Saved | `saveResult`: save the result to the dashboard Result tab. |
| `--max-age MILLISECONDS` | `0` | `maxAge`: return a cached result of the same request when it is newer than this age, up to 604800000 (7 days). A cached result costs the same tokens as the original scrape. `0` always scrapes fresh. |
| `--token-cap TOKENS` | Omitted | `tokenCap`: positive cap on tokens for the run and its retries. Omit for no limit. |
| `--max-retries N` | Omitted | `maxRetries`: nonnegative retry limit. Omit for no limit. |
| `--screenshot` | Off | `screenshot`: include a base64 screenshot in the response. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

`--wait-for-selector` needs a rendered page, so do not combine it with
`--no-browser-rendering`; the API rejects that pair without charging tokens.

## Inspect and Continue

Check the exit status and `data.success` before using the result. A failed
run returns `success: false` and is not billed. If fields are missing, make the
prompt more specific, add a schema, or enable browser rendering for pages that
load content dynamically. Do not repeat an identical failing request. For many
pages with one layout, test the prompt on a few representatives before running
the rest.

The command follows the [Scrape JSON reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-json).
