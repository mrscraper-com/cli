# MrScraper CLI

![MrScraper](./assets/mrscraper.jpeg)

Command-line access to the seven MrScraper services, with browser sign-in and optional agent skill setup.

## Overview

Seven services share the same descriptions, parameter meanings, and defaults across the CLI, SDKs, and integrations. Names, types, authentication, and code examples follow each surface's conventions. The standard reference is maintained in [docs/service-reference.json](docs/service-reference.json).

| Service                             | Public name       | Description                                                                                                                     |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Status](#status)                   | `status`          | Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.             |
| [Scrape HTML](#scrape-html)         | `scrape-html`     | Retrieve the raw HTML of a page. Browser rendering is optional.                                                                 |
| [Scrape Markdown](#scrape-markdown) | `scrape-markdown` | Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.                    |
| [Get screenshot](#get-screenshot)   | `get-screenshot`  | Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.                              |
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
  --wait-for-selector '.content' --timeout 120 --max-retries 0
```

Examples use `example.com` as the sample target. Replace it for your use case. Live scraping and search calls consume account quota.

## Shared parameters

### Page controls

HTML, Markdown, screenshots, and JSON extraction share `url`, `timeout`, `geoCode`, `proxyCountry`, `super`, `waitUntil`, `proxy`, `maxRetries`, and `saveResult` (using the naming style shown below). Page defaults are 300 seconds, US geolocation/proxy country, real-device routing off, and dashboard saving off. Omitted retry limits mean no limit. Exact types, defaults, and standard descriptions appear in each service table.

### Loading controls

HTML, Markdown, and screenshots additionally accept `blockResources`, `waitForSelector`, and `returnCookie`. JSON extraction does not accept these controls. Browser rendering is optional for HTML, Markdown, and JSON; screenshots always enable it. Markdown with HTML also enables browser rendering.

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

The complete account API response body is preserved inside data. If the API wraps account details in data, those details are available at data.data. Sensitive response headers are removed.

### Scrape HTML

#### Description

Retrieve the raw HTML of a page. Browser rendering is optional.

#### Parameters

| Parameter             | HTTP field         | Type                                                               | Default              | Description                                                                                     |
| --------------------- | ------------------ | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `<url>`               | `url`              | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `--timeout`           | `timeout`          | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `--geo-code`          | `geoCode`          | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `--proxy-country`     | `proxyCountry`     | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `--super`             | `super`            | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `--wait-until`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `--proxy`             | `proxy`            | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `--max-retries`       | `maxRetries`       | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `--save-result`       | `saveResult`       | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `--block-resources`   | `blockResources`   | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `--wait-for-selector` | `waitForSelector`  | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `--return-cookie`     | `returnCookie`     | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `--browser-rendering` | `browserRendering` | boolean                                                            | `false`              | Whether to render the page in a browser before returning the result.                            |
| `--warm-start`        | `warmStart`        | boolean                                                            | `false`              | Whether to enable warm start for more reliable scraping, at the cost of additional latency.     |

#### Example

```bash
mrscraper scrape-html https://example.com --browser-rendering --warm-start \
  --wait-for-selector '.content' --timeout 120 --max-retries 0
```

#### Response

The default response body is HTML text. Additional controls can cause the API to return JSON; the returned structure is preserved.

### Scrape Markdown

#### Description

Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.

#### Parameters

| Parameter             | HTTP field         | Type                                                               | Default              | Description                                                                                     |
| --------------------- | ------------------ | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `<url>`               | `url`              | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `--timeout`           | `timeout`          | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `--geo-code`          | `geoCode`          | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `--proxy-country`     | `proxyCountry`     | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `--super`             | `super`            | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `--wait-until`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `--proxy`             | `proxy`            | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `--max-retries`       | `maxRetries`       | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `--save-result`       | `saveResult`       | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `--block-resources`   | `blockResources`   | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `--wait-for-selector` | `waitForSelector`  | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `--return-cookie`     | `returnCookie`     | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `--browser-rendering` | `browserRendering` | boolean                                                            | `false`              | Whether to render the page in a browser before returning the result.                            |
| `--warm-start`        | `warmStart`        | boolean                                                            | `false`              | Whether to enable warm start for more reliable scraping, at the cost of additional latency.     |
| `--html`              | `html`             | boolean                                                            | `false`              | Whether to include the page HTML in the response.                                               |

#### Example

```bash
mrscraper scrape-markdown https://example.com --html --warm-start
```

#### Response

The default response body is Markdown text. Enabling HTML returns JSON containing both HTML and Markdown.

### Get screenshot

#### Description

Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.

#### Parameters

| Parameter                     | HTTP field        | Type                                                               | Default              | Description                                                                                     |
| ----------------------------- | ----------------- | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `<url>`                       | `url`             | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `--timeout`                   | `timeout`         | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `--geo-code`                  | `geoCode`         | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `--proxy-country`             | `proxyCountry`    | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `--super`                     | `super`           | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `--wait-until`                | `waitUntil`       | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `--proxy`                     | `proxy`           | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `--max-retries`               | `maxRetries`      | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `--save-result`               | `saveResult`      | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `--block-resources`           | `blockResources`  | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `--wait-for-selector`         | `waitForSelector` | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `--return-cookie`             | `returnCookie`    | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `--screenshot`                | `screenshot`      | string: `full`, `top`                                              | `"full"`             | Screenshot area to capture: full for the entire page or top for the top viewport.               |
| `--no-html (sets html=false)` | `html`            | boolean                                                            | `true`               | Whether to include the page HTML in the response.                                               |
| `--markdown`                  | `markdown`        | boolean                                                            | `false`              | Whether to include the page Markdown in the response.                                           |

#### Example

```bash
mrscraper get-screenshot https://example.com --screenshot top --no-html --markdown
```

#### Response

The response body contains a base64 screenshot and requested page outputs. The API can still include HTML when HTML output is disabled.

### Scrape brand

#### Description

Extract a website's colors, typography, logos, and social links as JSON.

#### Parameters

| Parameter | HTTP field | Type   | Default  | Description                                        |
| --------- | ---------- | ------ | -------- | -------------------------------------------------- |
| `<url>`   | `url`      | string | Required | Absolute HTTP or HTTPS URL of the page to process. |

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

The request uses `action=brand-scraping` and `bundle=none`; page controls are not accepted.

#### Example

```bash
mrscraper scrape-brand https://example.com
```

#### Response

The response body preserves the API brand result. Brand data is typically available at data.data.brand in the response envelope.

### Scrape JSON

#### Description

Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.

#### Parameters

| Parameter             | HTTP field         | Type                                                               | Default                                       | Description                                                                                             |
| --------------------- | ------------------ | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<url>`               | `url`              | string                                                             | Required                                      | Absolute HTTP or HTTPS URL of the page to process.                                                      |
| `--timeout`           | `timeout`          | integer                                                            | `300`                                         | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.             |
| `--geo-code`          | `geoCode`          | string                                                             | `"us"`                                        | Two-letter country code to load the page from, sent in lowercase.                                       |
| `--proxy-country`     | `proxyCountry`     | string                                                             | `"us"`                                        | Two-letter country code of the proxy server, sent in lowercase.                                         |
| `--super`             | `super`            | boolean                                                            | `false`                                       | Whether to route the request through real devices.                                                      |
| `--wait-until`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"`                          | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2.         |
| `--proxy`             | `proxy`            | string                                                             | Omitted                                       | Custom proxy URL used to load the page.                                                                 |
| `--max-retries`       | `maxRetries`       | integer                                                            | Omitted                                       | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                  |
| `--save-result`       | `saveResult`       | boolean                                                            | `false`                                       | Whether to save the result to the dashboard Result tab.                                                 |
| `--prompt`            | `prompt`           | string                                                             | `"Extract all data as complete as possible."` | Instructions describing the data to extract. Append Json Schema: and a JSON schema to shape the output. |
| `--browser-rendering` | `browserRendering` | boolean                                                            | `false`                                       | Whether to render the page in a browser before returning the result.                                    |
| `--html`              | `html`             | boolean                                                            | `false`                                       | Whether to include the page HTML in the response.                                                       |
| `--screenshot`        | `screenshot`       | boolean                                                            | `false`                                       | Whether to include a base64 screenshot in the response.                                                 |

The request uses `agent=general` and GET. If the encoded URL exceeds 8,000 characters, it switches to POST with `url`, `prompt`, and `agent` in the body; page controls remain in the query.

#### Example

```bash
mrscraper scrape-json https://example.com --browser-rendering \
  --prompt 'Extract the page title. Json Schema: {"type":"object","properties":{"title":{"type":"string"}}}'
```

#### Response

The response body contains the extraction result in the API's original structure. Optional HTML and screenshot outputs may add fields.

### Web search

#### Description

Search the web and return ranked results with titles, URLs, descriptions, and sources.

#### Parameters

| Parameter       | HTTP field   | Type    | Default  | Description                                                                                       |
| --------------- | ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<query>`       | `query`      | string  | Required | Search query text, trimmed before sending, containing 1 to 1000 characters.                       |
| `--country`     | `country`    | string  | `"us"`   | Two-letter country code to search from, sent in lowercase.                                        |
| `--num-results` | `numResults` | integer | `10`     | Number of search results to request, as an integer from 10 to 100. Fewer results may be returned. |

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

#### Example

```bash
mrscraper web-search "site:example.com documentation" --country id --num-results 20
```

#### Response

The response body contains success, message, and a data array. Each result includes rank, title, url, description, and source.

## Response format

Successful services use an envelope containing `status_code`, `data`, and `headers`. The `data` field contains the API response body; its field names are not converted to the SDK's naming style. Status preserves the complete body without adding summary fields.

```json
{
  "status_code": 200,
  "data": "<html><body>Example</body></html>",
  "headers": { "content-type": "text/html" }
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

Three repository-hosted skills cover setup and account usage, page retrieval, and search:

- [mrscraper](./skills/mrscraper/SKILL.md)
- [mrscraper-fetch](./skills/mrscraper-fetch/SKILL.md)
- [mrscraper-serp](./skills/mrscraper-serp/SKILL.md)

For programmatic JavaScript usage, import `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson`, `webSearch`, or `getSubscriptionAccountApi` from `@mrscraper/cli`. These low-level exports accept options objects; the internal JavaScript option for `super` is `superMode`.

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

For missing credentials, run `mrscraper login` or configure `MRSCRAPER_API_KEY`. For slow pages, increase the page timeout up to 300 seconds. Brand and search have fixed 120-second transport deadlines. Use `--help` on a command to inspect its accepted options. Save large output with shell redirection.

## Migration

Replace `account` with `status`. Replace combined `scraperAPI` / `scraper-api` calls with `scrape-html`, `scrape-markdown`, or `get-screenshot`. Search uses `web-search` with `country` and `num-results`. Legacy locale, header, token-budget, result, rerun, and bundle controls are outside the seven-service interface. `super` and `saveResult` default to false; omitted `maxRetries` means no limit.

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
