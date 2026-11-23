# MrScraper CLI

![MrScraper](./assets/mrscraper.jpeg)

Command-line access to the seven MrScraper services, with browser sign-in and optional agent skill setup.

## Overview

Seven services share the same descriptions, parameter meanings, and defaults across the CLI, SDKs, and integrations. Names, types, authentication, and code examples follow each surface's conventions. See the [API Reference](https://docs.mrscraper.com/docs/api/overview).

| Service                             | Public name       | Description                                                                                                                     |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Status](#status)                   | `status`          | Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.             |
| [Scrape HTML](#scrape-html)         | `scrape-html`     | Retrieve the raw HTML of a page. Browser rendering is optional.                                                                 |
| [Scrape Markdown](#scrape-markdown) | `scrape-markdown` | Retrieve a page as clean Markdown. Browser rendering is optional.                                                               |
| [Get screenshot](#get-screenshot)   | `get-screenshot`  | Capture a base64 PNG screenshot of the full page. Browser rendering is always enabled.                                          |
| [Scrape brand](#scrape-brand)       | `scrape-brand`    | Extract a website's colors, typography, logos, and social links as JSON.                                                        |
| [Scrape JSON](#scrape-json)         | `scrape-json`     | Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output. |
| [Web search](#web-search)           | `web-search`      | Search the web and return ranked results with titles, URLs, descriptions, and sources.                                          |

## Installation

Requires Node.js 20 or newer.

```bash
npm install -g @mrscraper/cli@latest
```

For the CLI and optional agent skill pack:

```bash
npx -y @mrscraper/cli@latest init --all
```

For automated setup, use `npx -y @mrscraper/cli@latest init --all --yes --skip-auth`, then run browser login explicitly when needed.

## Authentication

Obtain an API key from [the MrScraper app](https://app.mrscraper.com/api-tokens). API key used to authenticate the request.

```bash
mrscraper login
mrscraper auth status
```

Browser sign-in saves a dedicated API key in `~/.mrscraper/auth.json`. Keep `mrscraper login` running until browser approval completes. `--no-open` prints the sign-in URL. `--no-browser` is an explicit interactive API-key prompt.

For automation, set `MRSCRAPER_API_KEY`. `--token` overrides configured authentication for one service call; it is sent in headers, never in the request URL.

```bash
export MRSCRAPER_API_KEY="YOUR_TOKEN"
```

## Quickstart

```bash
mrscraper scrape-html https://example.com --browser-rendering --warm-start \
  --wait-for-selector 'body' --timeout 120 --max-retries 0
```

Examples use `example.com` as the sample target. Replace it for your use case. Live scraping and search calls consume account quota.

Response examples show selected keys and types observed in live API responses. Values are placeholders; page content, base64 images, and arrays are abbreviated. Actual responses may contain additional fields.

## Shared parameters

### Page controls

HTML, Markdown, screenshots, and JSON extraction share `url`, `timeout`, `waitForSelector`, `geoCode`, `saveResult`, `maxAge`, `tokenCap`, and `maxRetries` (using the naming style shown below). Defaults are a 300-second timeout (up to 330), dashboard saving on, and a `maxAge` of 0 milliseconds, which always scrapes fresh; `maxAge` accepts up to 604800000 (7 days). `geoCode`, `tokenCap`, and `maxRetries` are omitted unless set, so the API loads the page from the United States with no token or retry limit. Scrape brand accepts `url`, `timeout`, `warmStart`, and `geoCode` with the same defaults. Exact types, defaults, and standard descriptions appear in each service table.

### Loading controls

HTML, Markdown, and JSON extraction also accept `browserRendering`, `warmStart`, and `blockResources`; HTML and Markdown also accept `action`. `browserRendering` is omitted unless set: the API loads the page without a browser first and switches to one if the request is blocked, while `true` always renders and `false` never does. Screenshots always render in a browser: Get screenshot sends `browserRendering=true`, and so does Scrape HTML whenever a screenshot is set.

### Fixed request fields

Each service adds its documented fixed fields automatically, so they are not service parameters: `html=true` for HTML (plus `browserRendering=true` when a screenshot is set), `markdown=true` for Markdown, `screenshot=full` and `browserRendering=true` for screenshots, `action=brand-scraping` and `bundle=none` for brand, `agent=general` for JSON extraction, and `action=websearch` for search.

## Service reference

### Status

#### Description

Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.

#### Parameters

This service takes no service parameters. Authentication is configured separately.

The HTTP deadline is fixed at 600 seconds. It is not a service parameter.

#### Example

```bash
mrscraper status
```

#### Response

The API body contains message and data. Account details remain nested in data, including subscriptionItem and scraperAllowance. The response envelope therefore exposes account details at data.data. Sensitive response headers are removed.

**Success response**

```json
{
  "status_code": 200,
  "data": {
    "message": "Example response",
    "data": {
      "id": "ACCOUNT_ID",
      "tokenLimit": 100000,
      "tokenUsage": 2500,
      "stripeStatus": "active",
      "user": {
        "name": "Example user",
        "email": "user@example.com",
        "isVerified": true
      },
      "subscriptionItem": {
        "name": "Example plan",
        "tokenLimit": 100000
      },
      "scraperAllowance": {
        "remaining": 97500,
        "plans": [
          {
            "remaining": 97500
          }
        ]
      }
    }
  },
  "headers": {
    "content-type": "application/json; charset=utf-8"
  }
}
```

### Scrape HTML

#### Description

Retrieve the raw HTML of a page. Browser rendering is optional.

#### Parameters

| Parameter                                      | HTTP field         | Type    | Default  | Description                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<url>`                                        | `url`              | string  | Required | Absolute HTTP or HTTPS URL of the page to process.                                                                                                                                                                                                                                                    |
| `--browser-rendering / --no-browser-rendering` | `browserRendering` | boolean | Omitted  | Whether to load the page in a browser: true always does and false never does. Omit it to load the page without a browser first and switch to a browser automatically if the request is blocked.                                                                                                       |
| `--timeout`                                    | `timeout`          | integer | `300`    | Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.                                                                                                                                                                                                 |
| `--warm-start`                                 | `warmStart`        | boolean | `false`  | Whether to open the site's home page first to warm the session before loading the target URL.                                                                                                                                                                                                         |
| `--block-resources`                            | `blockResources`   | boolean | `false`  | Whether to block images, fonts, and stylesheets while loading the page.                                                                                                                                                                                                                               |
| `--wait-for-selector`                          | `waitForSelector`  | string  | Omitted  | CSS selector or text to wait for on the page before returning the result, up to 500 characters.                                                                                                                                                                                                       |
| `--action`                                     | `action`           | string  | Omitted  | Scraper action that routes the request or simply flags it, useful for separating analytics per domain.                                                                                                                                                                                                |
| `--geo-code`                                   | `geoCode`          | string  | Omitted  | Two-letter country code to load the page from, sent in lowercase.                                                                                                                                                                                                                                     |
| `--save-result / --no-save-result`             | `saveResult`       | boolean | `true`   | Whether to save the result to the dashboard Result tab.                                                                                                                                                                                                                                               |
| `--max-age`                                    | `maxAge`           | integer | `0`      | Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape.                                                                                                                                                      |
| `--token-cap`                                  | `tokenCap`         | integer | Omitted  | Maximum total tokens the scrape and its retries can use, as a positive integer. Omit this parameter for no limit.                                                                                                                                                                                     |
| `--max-retries`                                | `maxRetries`       | integer | Omitted  | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                                                                                                                                                                                                                |
| `--screenshot`                                 | `screenshot`       | string  | `false`  | Screenshot to capture with the HTML: false for none, full for the entire page, top for the first viewport, or a WIDTHxHEIGHT viewport from 100 to 3840 pixels with an optional -ZOOM percent from 25 to 300, such as 1280x800 or 1920x1080-75. Setting a screenshot also sends browserRendering=true. |

The request uses `html=true`. The screenshot is optional; setting one also sends `browserRendering=true`, because a screenshot needs a rendered page, and the response becomes JSON with `html` and `screenshot`.

#### Example

```bash
mrscraper scrape-html https://example.com --browser-rendering --warm-start \
  --wait-for-selector 'body' --timeout 120 --max-retries 0
```

#### Response

The response body is HTML text. With a screenshot, the API returns JSON containing html and a base64 screenshot.

**Default HTML text**

```json
{
  "status_code": 200,
  "data": "<html><body>Example page content...</body></html>",
  "headers": {
    "content-type": "text/html; charset=utf-8"
  }
}
```

**With a screenshot**

```json
{
  "status_code": 200,
  "data": {
    "html": "<html>...</html>",
    "screenshot": "BASE64_IMAGE_DATA"
  },
  "headers": {
    "content-type": "application/json; charset=utf-8"
  }
}
```

### Scrape Markdown

#### Description

Retrieve a page as clean Markdown. Browser rendering is optional.

#### Parameters

| Parameter                                      | HTTP field         | Type    | Default  | Description                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<url>`                                        | `url`              | string  | Required | Absolute HTTP or HTTPS URL of the page to process.                                                                                                                                              |
| `--browser-rendering / --no-browser-rendering` | `browserRendering` | boolean | Omitted  | Whether to load the page in a browser: true always does and false never does. Omit it to load the page without a browser first and switch to a browser automatically if the request is blocked. |
| `--timeout`                                    | `timeout`          | integer | `300`    | Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.                                                                                           |
| `--warm-start`                                 | `warmStart`        | boolean | `false`  | Whether to open the site's home page first to warm the session before loading the target URL.                                                                                                   |
| `--block-resources`                            | `blockResources`   | boolean | `false`  | Whether to block images, fonts, and stylesheets while loading the page.                                                                                                                         |
| `--wait-for-selector`                          | `waitForSelector`  | string  | Omitted  | CSS selector or text to wait for on the page before returning the result, up to 500 characters.                                                                                                 |
| `--action`                                     | `action`           | string  | Omitted  | Scraper action that routes the request or simply flags it, useful for separating analytics per domain.                                                                                          |
| `--geo-code`                                   | `geoCode`          | string  | Omitted  | Two-letter country code to load the page from, sent in lowercase.                                                                                                                               |
| `--save-result / --no-save-result`             | `saveResult`       | boolean | `true`   | Whether to save the result to the dashboard Result tab.                                                                                                                                         |
| `--max-age`                                    | `maxAge`           | integer | `0`      | Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape.                                                |
| `--token-cap`                                  | `tokenCap`         | integer | Omitted  | Maximum total tokens the scrape and its retries can use, as a positive integer. Omit this parameter for no limit.                                                                               |
| `--max-retries`                                | `maxRetries`       | integer | Omitted  | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                                                                                                          |

The request uses `markdown=true`.

#### Example

```bash
mrscraper scrape-markdown https://example.com --warm-start --max-age 86400000
```

#### Response

The response body is Markdown text.

**Default Markdown text**

```json
{
  "status_code": 200,
  "data": "# Example page\n\nExample Markdown content...",
  "headers": {
    "content-type": "text/markdown; charset=utf-8"
  }
}
```

### Get screenshot

#### Description

Capture a base64 PNG screenshot of the full page. Browser rendering is always enabled.

#### Parameters

| Parameter                          | HTTP field        | Type    | Default  | Description                                                                                                                                      |
| ---------------------------------- | ----------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<url>`                            | `url`             | string  | Required | Absolute HTTP or HTTPS URL of the page to process.                                                                                               |
| `--timeout`                        | `timeout`         | integer | `300`    | Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.                                            |
| `--wait-for-selector`              | `waitForSelector` | string  | Omitted  | CSS selector or text to wait for on the page before returning the result, up to 500 characters.                                                  |
| `--geo-code`                       | `geoCode`         | string  | Omitted  | Two-letter country code to load the page from, sent in lowercase.                                                                                |
| `--save-result / --no-save-result` | `saveResult`      | boolean | `true`   | Whether to save the result to the dashboard Result tab.                                                                                          |
| `--max-age`                        | `maxAge`          | integer | `0`      | Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape. |
| `--token-cap`                      | `tokenCap`        | integer | Omitted  | Maximum total tokens the scrape and its retries can use, as a positive integer. Omit this parameter for no limit.                                |
| `--max-retries`                    | `maxRetries`      | integer | Omitted  | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                                                           |

The request uses `screenshot=full` and `browserRendering=true`; the area and rendering are not service parameters.

#### Example

```bash
mrscraper get-screenshot https://example.com --wait-for-selector 'body' --timeout 120
```

#### Response

The response body is JSON containing a base64 PNG screenshot of the full page and the page HTML.

**Success response**

```json
{
  "status_code": 200,
  "data": {
    "html": "<html>...</html>",
    "screenshot": "BASE64_PNG_DATA"
  },
  "headers": {
    "content-type": "application/json; charset=utf-8"
  }
}
```

### Scrape brand

#### Description

Extract a website's colors, typography, logos, and social links as JSON.

#### Parameters

| Parameter      | HTTP field  | Type    | Default  | Description                                                                                           |
| -------------- | ----------- | ------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `<url>`        | `url`       | string  | Required | Absolute HTTP or HTTPS URL of the page to process.                                                    |
| `--timeout`    | `timeout`   | integer | `300`    | Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds. |
| `--warm-start` | `warmStart` | boolean | `false`  | Whether to open the site's home page first to warm the session before loading the target URL.         |
| `--geo-code`   | `geoCode`   | string  | Omitted  | Two-letter country code to load the page from, sent in lowercase.                                     |

The request uses `action=brand-scraping` and `bundle=none`. Like the page services, the HTTP request allows the timeout plus 30 seconds.

#### Example

```bash
mrscraper scrape-brand https://example.com --geo-code gb
```

#### Response

The API body contains message and a data object with job_id, status, url, final_url, brand, and error. Brand details are available at data.data.brand in the response envelope.

**Success response**

```json
{
  "status_code": 200,
  "data": {
    "data": {
      "job_id": "JOB_ID",
      "status": "succeeded",
      "url": "https://example.com",
      "final_url": "https://example.com",
      "brand": {
        "name": "Example brand",
        "colors": {
          "background": "#ffffff",
          "text": "#222222"
        },
        "typography": {
          "body": {
            "font_family": "Example font"
          }
        }
      },
      "error": null,
      "bundle_url": null
    },
    "message": "Example response"
  },
  "headers": {
    "content-type": "application/json"
  }
}
```

### Scrape JSON

#### Description

Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.

#### Parameters

| Parameter                                      | HTTP field         | Type    | Default                                       | Description                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------ | ------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<url>`                                        | `url`              | string  | Required                                      | Absolute HTTP or HTTPS URL of the page to process.                                                                                                                                              |
| `--prompt`                                     | `prompt`           | string  | `"Extract all data as complete as possible."` | Instructions describing the data to extract. Append Json Schema: and a JSON schema to shape the output.                                                                                         |
| `--html / --no-html`                           | `html`             | boolean | `true`                                        | Whether to include the page HTML in the response.                                                                                                                                               |
| `--browser-rendering / --no-browser-rendering` | `browserRendering` | boolean | Omitted                                       | Whether to load the page in a browser: true always does and false never does. Omit it to load the page without a browser first and switch to a browser automatically if the request is blocked. |
| `--timeout`                                    | `timeout`          | integer | `300`                                         | Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.                                                                                           |
| `--warm-start`                                 | `warmStart`        | boolean | `false`                                       | Whether to open the site's home page first to warm the session before loading the target URL.                                                                                                   |
| `--block-resources`                            | `blockResources`   | boolean | `false`                                       | Whether to block images, fonts, and stylesheets while loading the page.                                                                                                                         |
| `--wait-for-selector`                          | `waitForSelector`  | string  | Omitted                                       | CSS selector or text to wait for on the page before returning the result, up to 500 characters.                                                                                                 |
| `--geo-code`                                   | `geoCode`          | string  | Omitted                                       | Two-letter country code to load the page from, sent in lowercase.                                                                                                                               |
| `--save-result / --no-save-result`             | `saveResult`       | boolean | `true`                                        | Whether to save the result to the dashboard Result tab.                                                                                                                                         |
| `--max-age`                                    | `maxAge`           | integer | `0`                                           | Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape.                                                |
| `--token-cap`                                  | `tokenCap`         | integer | Omitted                                       | Maximum total tokens the scrape and its retries can use, as a positive integer. Omit this parameter for no limit.                                                                               |
| `--max-retries`                                | `maxRetries`       | integer | Omitted                                       | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                                                                                                          |
| `--screenshot`                                 | `screenshot`       | boolean | `false`                                       | Whether to include a base64 screenshot in the response.                                                                                                                                         |

The request uses `agent=general` and GET. If the encoded URL exceeds 8,000 characters, it switches to POST with `url`, `prompt`, and `agent` in the body; page controls remain in the query.

#### Example

```bash
mrscraper scrape-json https://example.com --browser-rendering \
  --prompt 'Extract the first 2 items with title and price. Json Schema: {"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"string"}},"required":["title","price"]}}'
```

#### Response

Extraction results are in the API body's data field and follow the requested schema. Response metadata includes thread_id, token_usage, status, error, runtime, and cookies. html contains the page HTML unless disabled; markdown and screenshot can be empty strings.

**Success response**

```json
{
  "status_code": 200,
  "data": {
    "success": true,
    "data": [
      {
        "title": "Example item",
        "price": "10.00"
      }
    ],
    "thread_id": "THREAD_ID",
    "token_usage": 1,
    "html": "<html>...</html>",
    "markdown": "",
    "screenshot": "",
    "status": "Results ready",
    "error": "",
    "runtime": 1.23,
    "cookies": []
  },
  "headers": {
    "content-type": "application/json"
  }
}
```

### Web search

#### Description

Search the web and return ranked results with titles, URLs, descriptions, and sources.

#### Parameters

| Parameter       | HTTP field   | Type    | Default  | Description                                                                                       |
| --------------- | ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<query>`       | `query`      | string  | Required | Search query text, trimmed before sending, containing 1 to 1000 characters.                       |
| `--country`     | `country`    | string  | Omitted  | Two-letter country code to search from, sent in lowercase.                                        |
| `--num-results` | `numResults` | integer | `10`     | Number of search results to request, as an integer from 10 to 100. Fewer results may be returned. |

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

The request uses `action=websearch`. `country` is omitted unless set, so the API searches from the United States.

#### Example

```bash
mrscraper web-search "site:example.com documentation" --country id --num-results 20
```

#### Response

The API body contains success, message, a data array, and tokenUsage. Each result includes rank, title, url, description, and source.

**Success response**

```json
{
  "status_code": 200,
  "data": {
    "success": true,
    "message": "Example response",
    "data": [
      {
        "rank": 1,
        "title": "Example result",
        "url": "https://example.com",
        "description": "Example result description.",
        "source": "example.com"
      }
    ],
    "tokenUsage": 1
  },
  "headers": {
    "content-type": "application/json; charset=utf-8"
  }
}
```

## Response format

Successful services use an envelope containing `status_code`, `data`, and `headers`. The `data` field contains the API response body; its field names are not converted to the SDK's naming style. Status preserves the complete body without adding summary fields.

```json
{
  "status_code": 200,
  "data": "<html><body>Example page content...</body></html>",
  "headers": {
    "content-type": "text/html; charset=utf-8"
  }
}
```

The CLI prints the envelope as JSON to stdout. It filters credential-bearing response headers and redacts known credential metadata in scraping/search JSON; status body fields are preserved.

## Error handling

Failed API calls print a JSON envelope with `error` and set a nonzero exit code. HTTP status remains in `status_code`; network failures use `null`. Progress is written to stderr so stdout stays machine-readable. Invalid arguments fail before the request.

```bash
mrscraper scrape-html https://example.com > result.json
```

## Integration features

### Configuration

The CLI also provides `init`, `login`, `auth status`, `logout`, and `setup skills`. Service options use kebab-case. `status --json` is accepted for compatibility; JSON is already the default.

Agent setup supports Claude Code, Cursor, Codex, Grok Build, Hermes Agent, OpenCode, OpenClaw, Pi, and Oh My Pi. `init --all` targets detected harnesses; `init --agent NAME` targets one. `--yes`, `--skip-auth`, and noninteractive input leave authentication for an explicit login.

```bash
mrscraper init --agent codex --yes --skip-auth
mrscraper init --all --yes --skip-auth --dry-run
mrscraper setup skills
mrscraper setup skills --agent hermes
```

### Advanced usage

Seven repository-hosted skills cover setup and account usage, plus one skill for each scraping and search command:

- [mrscraper](./skills/mrscraper/SKILL.md)
- [mrscraper-scrape-html](./skills/mrscraper-scrape-html/SKILL.md)
- [mrscraper-scrape-markdown](./skills/mrscraper-scrape-markdown/SKILL.md)
- [mrscraper-get-screenshot](./skills/mrscraper-get-screenshot/SKILL.md)
- [mrscraper-scrape-brand](./skills/mrscraper-scrape-brand/SKILL.md)
- [mrscraper-scrape-json](./skills/mrscraper-scrape-json/SKILL.md)
- [mrscraper-web-search](./skills/mrscraper-web-search/SKILL.md)

For programmatic JavaScript usage, import `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson`, `webSearch`, or `getSubscriptionAccountApi` from `@mrscraper/cli`. These low-level exports accept options objects that use the HTTP field names shown in each service table.

```js
import { scrapeHtml } from "@mrscraper/cli";
const result = await scrapeHtml({
  token: process.env.MRSCRAPER_API_KEY,
  url: "https://example.com",
});
console.log(result.data);
```

Hosted MCP setup is separate from the CLI and agent skill bootstrap. [MrScraper MCP](https://github.com/mrscraper-com/mrscraper-mcp) exposes `status`, `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson`, and `webSearch`. Native agent plugins are maintained separately for [ChatGPT and Codex](https://github.com/mrscraper-com/mrscraper-chatgpt-plugin) and [Claude](https://github.com/mrscraper-com/mrscraper-claude-plugin).

### Troubleshooting

For missing credentials, run `mrscraper login` or configure `MRSCRAPER_API_KEY`. For slow pages, increase the timeout up to 330 seconds. Search has a fixed 120-second transport deadline. Use `--help` on a command to inspect its accepted options. Save large output with shell redirection.

## Migration

Version 0.8.0 matches the Scraper API reference. Removed options: `--super`, `--wait-until`, `--proxy-country`, `--proxy`, `--return-cookie`, `scrape-markdown --html`, and the `get-screenshot` options `--screenshot`, `--no-html`, and `--markdown`; screenshots always capture the full page. New options: `--max-age`, `--token-cap`, `--action` for HTML and Markdown, `--no-browser-rendering`, and `scrape-html --screenshot`; JSON extraction now accepts `--warm-start`, `--block-resources`, and `--wait-for-selector`; `scrape-brand` now accepts `--timeout`, `--warm-start`, and `--geo-code`, and its HTTP deadline follows the timeout. Changed defaults: results are saved to the dashboard (`--no-save-result` opts out), Scrape JSON includes HTML (`--no-html` opts out), browser rendering is automatic unless set, `--geo-code` and `--country` are omitted unless set, and page timeouts accept up to 330 seconds. Earlier releases replaced `account` with `status` and the combined `scraper-api` command with the six scraping and search commands.

## Development and testing

### Automated checks

The automated suite checks service behavior without production API calls.

```bash
npm install
npm test
node bin/mrscraper.js --help
```

### Manual checks

The following commands call the live API using your credentials and consume quota.

```bash
mrscraper status
mrscraper scrape-html https://example.com
mrscraper web-search "site:example.com documentation"
```

## License

MIT. See [LICENSE](./LICENSE).
