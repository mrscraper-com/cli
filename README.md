# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

Official command-line client for [MrScraper](https://app.mrscraper.com). It retrieves pages as HTML, Markdown, screenshots, brand data, or extracted JSON through the Scraper API, searches the web, and reports account usage.

The six scraping and search commands return a consistent JSON envelope
containing `status_code`, the response in `data`, and non-sensitive response
`headers`. The `status` command summarizes the account and renders a dashboard
in an interactive terminal. Progress uses stderr, and failed API calls exit
non-zero.

## Install

Requires Node.js 20 or newer.

One interactive command installs the CLI globally and copies all three
MrScraper skills into every supported agent harness detected on the machine:

```bash
npx -y @mrscraper/cli@latest init --all
```

If no credential exists, this human-facing command starts browser sign-in. An
existing `~/.mrscraper/auth.json` or `MRSCRAPER_API_KEY` is reused by the CLI.

Agents use the non-interactive form so setup never waits for secret input, then
launch browser login only when authentication is still missing:

```bash
npx -y @mrscraper/cli@latest init --all --yes --skip-auth
mrscraper auth status --json
mrscraper login
```

The agent keeps `mrscraper login` running while the user approves access in the
browser. The CLI exchanges that approval for a dedicated API key and saves it
locally. In headless automation, set `MRSCRAPER_API_KEY` instead.

For a CLI-only installation:

```bash
npm install -g @mrscraper/cli@latest
mrscraper login
```

You can also run the current checkout:

```bash
npm install
node bin/mrscraper.js --help
```

### Agent onboarding

The bootstrap installs three focused skills through the public `skills`
installer:

- [`mrscraper`](./skills/mrscraper/SKILL.md) — onboarding, authentication,
  routing, shared output rules, account status, troubleshooting, and limits;
- [`mrscraper-fetch`](./skills/mrscraper-fetch/SKILL.md) — page retrieval with
  `scrape-html`, `scrape-markdown`, `get-screenshot`, `scrape-json`, and
  `scrape-brand`, including page-loading controls; and
- [`mrscraper-serp`](./skills/mrscraper-serp/SKILL.md) — query-first web
  discovery with `web-search` and handoff to page retrieval.

Raw onboarding URL:

```text
https://raw.githubusercontent.com/mrscraper-com/cli/main/skills/mrscraper/SKILL.md
```

Copyable AI setup prompt:

```text
Install MrScraper for this coding agent. Detect the client from the environment,
then run `npx -y @mrscraper/cli@latest init --agent <client> --yes --skip-auth`
yourself. This installs the CLI and all three MrScraper skills without waiting
for authentication. Never ask me to paste an API key into chat. Check
`mrscraper auth status --json`; if no credential is configured and this is a local
interactive session, run `mrscraper login`, keep it running, and let me approve
the browser request. In a headless session, tell me to configure
MRSCRAPER_API_KEY instead. Then confirm the CLI works and report which
MrScraper skills were installed.
```

MrScraper also offers an optional hosted MCP server; see
[Hosted MCP](#hosted-mcp-optional).

### Install for one agent

Use the same `npx` bootstrap for a specific agent. In an interactive terminal,
it starts browser sign-in when authentication is missing:

```bash
# Claude Code
npx -y @mrscraper/cli@latest init --agent claude-code

# Cursor
npx -y @mrscraper/cli@latest init --agent cursor

# Codex
npx -y @mrscraper/cli@latest init --agent codex

# Grok Build
npx -y @mrscraper/cli@latest init --agent grok

# Hermes Agent
npx -y @mrscraper/cli@latest init --agent hermes

# OpenCode
npx -y @mrscraper/cli@latest init --agent opencode

# OpenClaw
npx -y @mrscraper/cli@latest init --agent openclaw

# Pi
npx -y @mrscraper/cli@latest init --agent pi

# Oh My Pi
npx -y @mrscraper/cli@latest init --agent omp
```

A local agent should append `--yes --skip-auth`, then run `mrscraper login`
separately and wait for the user to approve in the browser. For a headless host,
use `--skip-auth` and provide `MRSCRAPER_API_KEY`, or run
`mrscraper login --no-browser` in a human-controlled terminal.

### What `init` does

`mrscraper init` sets up the CLI workflow:

1. Installs the MrScraper CLI.
2. Reuses existing authentication or starts browser login when needed.
3. Installs all three MrScraper skills.

It supports Claude Code, Cursor, Codex, Grok Build, Hermes Agent, OpenCode,
OpenClaw, Pi, and Oh My Pi. Agent-specific setup is handled automatically.

Useful variants:

```bash
mrscraper init --agent codex --yes --skip-auth
mrscraper init --agent hermes --yes --skip-auth
mrscraper init --agent openclaw --yes --skip-auth
mrscraper init --all --yes --skip-auth
mrscraper init --all --yes --skip-auth --dry-run
mrscraper setup skills
mrscraper setup skills --agent codex
mrscraper setup skills --agent grok
```

`--all` installs only into detected harnesses. `setup skills` refreshes the
complete pack without changing authentication. The bootstrap does not install
MCP, add templates, or select default provider settings. Interactive `init`
starts browser login when no credential exists; non-interactive input, `--yes`,
or `--skip-auth` leaves it for an explicit `mrscraper login`. Package-runner
flags such as `npx -y` approve package execution only; they do not authenticate
the CLI.

### Agent plugins (separate repositories)

Native agent plugins are maintained separately from this CLI repository:

- [MrScraper for ChatGPT and Codex](https://github.com/mrscraper-com/mrscraper-chatgpt-plugin)
- [MrScraper for Claude](https://github.com/mrscraper-com/mrscraper-claude-plugin)

Those plugins package MCP-oriented skills with the hosted MrScraper MCP server.
Use `mrscraper init` when you want this repository's CLI-oriented skill pack
instead.

## Hosted MCP (optional)

MCP setup is separate from the CLI and skill bootstrap. The hosted server at
`https://mcp.mrscraper.com/mcp` exposes the same capabilities as the CLI through
the `scraperAPI`, `webSearch`, and `status` tools. Clients that support OAuth
sign in through the browser; other clients send an
[API key](https://app.mrscraper.com/api-tokens) as a bearer token:

```text
URL: https://mcp.mrscraper.com/mcp
Authorization: Bearer <MRSCRAPER_API_KEY>
```

To run the server yourself, see
[`@mrscraper/mcp`](https://github.com/mrscraper-com/mrscraper-mcp).

## Authentication

Browser sign-in is the interactive default:

```bash
mrscraper login
mrscraper auth status
```

Use `mrscraper login --no-open` to print the URL without launching a browser. An
agent may launch `mrscraper login` when the user and browser are on the same
machine, but the user must approve the request. It never falls back to a secret
prompt; `--no-browser` is an explicit human-only API-key prompt.

API keys remain supported for CI and other non-interactive environments:

```bash
mrscraper login --api-key "your-key"
export MRSCRAPER_API_KEY="your-key"
mrscraper scrape-html https://www.scrapethissite.com/pages/simple/ --token "your-key"
```

Get API keys from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens). Avoid
putting secrets directly in shell history; environment variables are preferred
for automation.

## Command Summary

```text
init             bootstrap the CLI and detected agent skill pack
login            use browser sign-in or explicitly save an API key
auth             inspect local credential configuration
logout           remove local credentials
setup            install or refresh the skill pack
scrape-html      retrieve raw page HTML
scrape-markdown  retrieve clean page Markdown
get-screenshot   capture a full-page or top viewport screenshot
scrape-brand     extract a website's brand
scrape-json      extract structured JSON with a natural-language prompt
web-search       search the web and return ranked results
status           show the account's subscription, token usage, and limits
```

CLI command names use kebab-case; JavaScript exports use camelCase. The six
scraping and search commands send GET requests to `https://api.mrscraper.com`
and authenticate with the `x-api-token` header, so the API key never appears in
a request URL. These CLI changes do not change the separately hosted MCP
server's tool names.

## `scrape-html` and `scrape-markdown`

HTML and Markdown bodies are preserved as strings in the response envelope's
`data` field. `scrape-markdown --html` also returns the page HTML: the page is
rendered in Chromium (the API requires it for this combination) and `data`
holds `{ "html": "...", "markdown": "..." }`.

```bash
mrscraper scrape-html https://books.toscrape.com/ | jq -r '.data'
mrscraper scrape-markdown https://books.toscrape.com/ | jq -r '.data'
mrscraper scrape-markdown https://example.com --browser-rendering \
  --wait-for-selector '.products' --geo-code id
```

`scrape-html` always sends `html=true&markdown=false&screenshot=false`;
`scrape-markdown` always sends `markdown=true&screenshot=false`.
See [Scrape HTML](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html)
and [Scrape Markdown](https://docs.mrscraper.com/docs/api/scraper-api/scrape-markdown).

### Page-loading options

These controls are shared by `scrape-html`, `scrape-markdown`, `get-screenshot`,
and `scrape-json`. The CLI always sends the defaults below; `super` and
`saveResult` are off unless requested, although the API itself defaults them
to on.

| Option | Request field | Default | Behavior |
| --- | --- | --- | --- |
| `<url>` | `url` | required | Absolute HTTP or HTTPS target URL. |
| `--browser-rendering` | `browserRendering` | off | Render the page in Chromium. Not on `get-screenshot`, which always renders. |
| `--super` | `super` | off | Route the request through real devices. |
| `--wait-until <event>` | `waitUntil` | `domcontentloaded` | `domcontentloaded`, `load`, `networkidle0`, or `networkidle2`. |
| `--wait-for-selector <selector>` | `waitForSelector` | — | Wait for a CSS selector. Not on `scrape-json`. |
| `--block-resources` | `blockResources` | off | Block images, fonts, and stylesheets. Not on `scrape-json`. |
| `--return-cookie` | `returnCookie` | off | Include browser session cookies. Not on `scrape-json`. |
| `--timeout <seconds>` | `timeout` | `300` | Page timeout, 1–300 seconds; the request allows 30 more. |
| `--geo-code <code>` | `geoCode` | `us` | Two-letter country to load the page from. |
| `--proxy-country <code>` | `proxyCountry` | `us` | Two-letter proxy server country. |
| `--proxy <url>` | `proxy` | — | Send the request through your own proxy. |
| `--max-retries <n>` | `maxRetries` | no limit | Nonnegative retry limit; zero disables retries. |
| `--save-result` | `saveResult` | off | Save the result to the dashboard Result tab. |
| `--token <key>` | authentication | configured | Override configured credentials. |

Country codes are lowercased before sending. Tokens used are reported in the
`token_usage` response header. The target page's status can be reported in
`x-status-code`.

## `get-screenshot`

Use `--screenshot full` (default) for the entire page or `--screenshot top`
for the viewport. Browser rendering is always enabled. The response JSON is
in `data`, with a base64 PNG in `data.screenshot` and the page HTML in
`data.html`. `--no-html` sends `html=false`, although the API currently still
returns the HTML. `--markdown` adds `data.markdown`.

```bash
mrscraper get-screenshot https://example.com --no-html \
  | jq -r '.data.screenshot' | base64 --decode > page.png
mrscraper get-screenshot https://example.com --screenshot top --markdown
```

See [Get Screenshot](https://docs.mrscraper.com/docs/api/scraper-api/get-screenshot).

## `scrape-brand`

Extract brand colors, typography, logos, social links, and metadata. The
request sends `action=brand-scraping&bundle=none` and returns brand JSON only.
Brand data is in `data.data.brand`, and the job ID is in `data.data.job_id`
(the outer `data` is the CLI envelope).

```bash
mrscraper scrape-brand https://mrscraper.com/ | jq '.data.data.brand'
```

The page bundles (`bundle=clean` and `bundle=full`) are not available from the
CLI. When a page has no usable brand data, the API can answer HTTP 422 with a
settled job and no tokens charged; the CLI prints the response and exits
non-zero.

See [Scrape Brand](https://docs.mrscraper.com/docs/api/scraper-api/scrape-brand/scrape-brand).

## `scrape-json`

Describe the structured data to extract with `--prompt`. It defaults to
`Extract all data as complete as possible.` The `general` agent parses the
scraped content; the prompt does not control browser navigation. Append
`Json Schema:` and a schema to shape the output.

```bash
mrscraper scrape-json https://books.toscrape.com/ \
  --prompt 'Extract book titles and prices' | jq '.data.data'
```

`--html` adds the page HTML and `--screenshot` adds a base64 screenshot; both
are off by default. The request is a GET. When a long prompt would push the
URL past the API's 8 KB limit, the CLI sends the documented POST variant
instead, with `url`, `prompt`, and `agent` in the JSON body.
See [Scrape JSON](https://docs.mrscraper.com/docs/api/scraper-api/scrape-json).

## `web-search`

Send query text as `GET /?action=websearch&query=...&country=us&numResults=10`:

```bash
mrscraper web-search "e-menessaptieka.lv linkedin" --country us --num-results 10
mrscraper web-search "running shoes" --country id --num-results 20
```

| Option | Default | Description |
| --- | --- | --- |
| `<query>` | required | Search query, 1–1000 characters. |
| `--country <code>` | `us` | Two-letter country code to search from. |
| `--num-results <n>` | `10` | Number of results, from 10 to 100. |
| `--token <key>` | configured credential | Override authentication. |

The API response is in the envelope's `data` field. Fewer results may be
returned than requested.

## `status`

Show subscription and token usage:

```bash
mrscraper status
mrscraper status --json
```

In a terminal, the default dashboard shows subscription health, account
verification, a token-usage progress bar, rate limits, renewal state, and the
subscription end date. Redirected output is JSON so scripts and agents can
parse it reliably. Use `--pretty` or `--json` to select either format
explicitly. The CLI reads `/subscription-accounts`, removes credential and
billing metadata, and calculates `token_remaining` and `usage_percent`. JSON
output is labeled with `kind: "mrscraper-cli-status-summary"` and lists its
source endpoints.

| Option | Default | Description |
| --- | --- | --- |
| `--json` | automatic | Print the account summary as JSON. |
| `--pretty` | automatic | Always render the account dashboard. |
| `--no-color` | off | Disable ANSI color in the dashboard. |
| `--token <key>` | — | Override configured authentication with an API key. |

## Migration to 0.7.0

0.7.0 replaces the 0.6.0 commands and exports:

| 0.6.0 | 0.7.0 |
| --- | --- |
| `scraperAPI URL` / `scraperAPI()` | `scrape-html URL` / `scrapeHtml()` |
| `scraperAPI URL --markdown --no-html` | `scrape-markdown URL` / `scrapeMarkdown()` |
| `scraperAPI URL --screenshot` | `get-screenshot URL` / `getScreenshot()` |
| — | `scrape-json URL` / `scrapeJson()` |
| — | `scrape-brand URL` / `scrapeBrand()` |
| `webSearch QUERY` | `web-search QUERY` / `webSearch()` |
| `account` / `account()` | `status` / `getSubscriptionAccountApi()` with `summarizeSubscriptionAccount()` |

From 0.3.x, `scraper-api` maps to the same commands as `scraperAPI`, and
`web-search --region` becomes `web-search --country`; Google search URLs and
`--language`, `--page`, `--format`, and `--render-js` are removed.

Removed options: `--save <path>` (redirect stdout instead), `--token-cap`,
`--home-page`, `--cookie-jar`, `--headers`, `--stream`, `--bypass-proxy`,
`--no-use-proxy`, `--discard-token-secret`, and `--timeout` on the search and
account commands.

Changed defaults:

- `super=false` and `saveResult=false` are sent unless `--super` or
  `--save-result` is passed. Results no longer appear in the dashboard Result
  tab by default.
- `--max-retries` is no longer 3 by default; when omitted, the API applies no
  retry limit.
- `web-search --country` defaults to `us`.

## Programmatic API

```js
import {
  scrapeHtml, scrapeMarkdown, getScreenshot,
  scrapeBrand, scrapeJson, webSearch,
  getSubscriptionAccountApi,
} from "@mrscraper/cli";

const token = process.env.MRSCRAPER_API_KEY;
const page = await scrapeHtml({ token, url: "https://example.com" });
const shot = await getScreenshot({ token, url: "https://example.com", screenshot: "top" });
const search = await webSearch({ token, query: "MrScraper", country: "us", numResults: 10 });
```

Options use the request field names in camelCase, such as `browserRendering`,
`waitForSelector`, `maxRetries`, and `saveResult`; `super` is `superMode`.
Inputs are validated before any request, and fields a command does not
support are never sent. All functions return the same JSON envelope as the
CLI. Credential helpers and `request` remain exported.

## Development

```bash
npm install
npm test
node bin/mrscraper.js --help
```

Run the package and skill bootstrap smoke test inside Docker so global npm and
agent-directory writes stay out of the host environment:

```bash
docker build --file test/bootstrap.Dockerfile .
```

For local integration tests, API hosts may be overridden with `MRSCRAPER_API_BASE_URL` and `MRSCRAPER_FETCH_BASE_URL`.

## License

MIT — see [LICENSE](./LICENSE).
