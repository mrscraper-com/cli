# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

Official command-line client for [MrScraper](https://app.mrscraper.com). It retrieves pages as HTML, Markdown, or screenshots through the Scraper API, searches Google, and reports account usage.

The `scraper-api` and `web-search` commands return a consistent JSON envelope
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
  `scraper-api`: HTML, Markdown, screenshots, and page-loading controls; and
- [`mrscraper-serp`](./skills/mrscraper-serp/SKILL.md) — query-first Google
  discovery with `web-search` and handoff to `scraper-api`.

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
mrscraper scraper-api https://www.scrapethissite.com/pages/simple/ --token "your-key"
```

Get API keys from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens). Avoid
putting secrets directly in shell history; environment variables are preferred
for automation.

## Command Summary

```text
init         bootstrap the CLI and detected agent skill pack
login        use browser sign-in or explicitly save an API key
auth         inspect local credential configuration without contacting the API
logout       remove local credentials
setup        install or refresh the skill pack
scraper-api  retrieve a page as HTML, Markdown, a screenshot, or a combination
web-search   search Google from query text or a Google search URL
status       show the account's subscription, token usage, and limits
```

The commands follow the Python SDK's `scraper_api()` and `web_search()` methods
and the hosted MCP server's `scraperAPI`, `webSearch`, and `status` tools.

## `scraper-api`

`scraper-api` retrieves one page through MrScraper's
[page-fetching service](https://docs.mrscraper.com/docs/features/unblocker) with
`POST https://api.mrscraper.com/`. It requests HTML by default; the content is
in the envelope's `data` object:

```bash
mrscraper scraper-api https://www.scrapethissite.com/pages/simple/

# Print only the HTML
mrscraper scraper-api https://www.scrapethissite.com/pages/simple/ | jq -r '.data.html'

# Markdown instead of HTML
mrscraper scraper-api https://www.scrapethissite.com/pages/simple/ \
  --markdown --no-html | jq -r '.data.markdown'

# Screenshot as a JPEG file
mrscraper scraper-api https://www.scrapethissite.com/pages/simple/ --screenshot --no-html \
  | jq -r '.data.screenshot' | base64 --decode > simple.jpg
```

`data` also reports `token_usage`, `runtime`, `retry_count`, and `error`. The
`x-status-code` response header carries the target page's status.

Browser rendering is automatic unless you set it: the service falls back to a
browser when needed. `--browser-rendering` forces a browser,
`--no-browser-rendering` disables it, and `--screenshot` always uses one.
Real-device routing (`--super`) is independent of browser rendering.

```bash
mrscraper scraper-api URL --browser-rendering --wait-for-selector '.products'
mrscraper scraper-api URL --super --geo-code ID --home-page
mrscraper scraper-api URL --block-resources --max-retries 1 --token-cap 10
```

| CLI option | Request field | Default | Behavior |
| --- | --- | --- | --- |
| `<url>` | body `url` | required | Target page URL. |
| `--no-html` | query `html` | `true` | Skip HTML content. |
| `--markdown` | query `markdown` | `false` | Request Markdown content. |
| `--screenshot` | query `screenshot` | off | Capture a base64 JPEG; forces browser rendering. |
| `--browser-rendering` / `--no-browser-rendering` | query `browserRendering` | automatic | Force or disable browser rendering. |
| `--super` | query `super` | off | Real-device routing. |
| `--geo-code <code>` | query `geoCode` | `US` | Proxy country. |
| `--proxy-country <code>` | query `proxyCountry` | omitted | Compatibility country option. |
| `--no-use-proxy` | query `useProxy` | proxy allowed | Do not use the service's configured proxy. |
| `--proxy <proxy>` | query `proxy` | omitted | Custom proxy as `username:password@host:port`. |
| `--wait-for-selector <selector>` | query `waitForSelector` | omitted | CSS selector to wait for. |
| `--home-page` | query `warmStart` | off | Visit the site's root before the target page. |
| `--block-resources` | query `blockResources` | off | Block images, CSS, and fonts. |
| `--bypass-proxy` | query `bypassProxy` | off | Enable the proxy-bypass behavior. |
| `--cookie-jar <config>` | query `cookieJar` | omitted | Cookie configuration, such as `domain=example.org&country=us&max_used=100&max_age=50m`. |
| `--headers <json>` | query `headers` | omitted | Target page request headers as a JSON object. |
| `--max-retries <n>` | body `maxRetries` | `3` | Maximum retries; zero disables retries. |
| `--token-cap <n>` | body `tokenCap` | omitted | Running token total that stops further retries; the initial request always runs. |
| `--timeout <seconds>` | query `timeout` | `120` | Page timeout from 1 to 300 seconds; the CLI waits 30 seconds more for the response. |
| `--stream` | query `stream` | omitted | Ask the API to stream; the CLI still prints one JSON response. |
| `--discard-token-secret <secret>` | header `x-discard-token-secret` | omitted | Optional upstream header. |
| `--token <key>` | authentication | configured credential | Override authentication for this command. |

Usage is calculated from runtime and bandwidth: one plan token per 30 seconds
and one plan token per 0.25 MB, rounded up per component. Resource blocking can
reduce bandwidth for text-focused pages. See the
[Token Plan](https://docs.mrscraper.com/docs/getting-started/api-token) for the
complete calculation.

## `web-search`

Search Google using either query text or an existing search URL:

```bash
mrscraper web-search "iphone 17"
mrscraper web-search "running shoes" --region id --language id --page 2
mrscraper web-search "https://www.google.com/search?q=iphone+17&gl=us&hl=en"
mrscraper web-search "iphone 17" --format html --render-js
```

The command sends `POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync`.
Parsed results are the default; organic results are in `data.data.organic`.

| Option | Default | Description |
| --- | --- | --- |
| `--region <code>` | from URL or omitted | Google result country. |
| `--language <code>` | from URL or omitted | Google result language. |
| `--page <n>` | from URL or omitted | One-based result page. |
| `--format <format>` | `json` | Parsed `json` or result-page `html`. |
| `--render-js` | off | Render JavaScript-dependent features, such as AI Overview. |
| `--timeout <seconds>` | `600` | Set the command's HTTP request deadline. |
| `--token <key>` | — | Override configured authentication with an API key. |

A complete Google search URL is parsed into the request's `query`, `region`,
`language`, and `page` fields. Explicit options take precedence.

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

## Removed commands

`fetch`, `scrape`, `serp`, `rerun`, `results`, and `result` were removed in
favor of the three commands above:

| Previous command | Replacement |
| --- | --- |
| `fetch` | `scraper-api`; `--super-mode` is now `--super`, and browser rendering is automatic unless set. |
| `serp` | `web-search`; `--client-timeout` is now `--timeout`, and `--raw` is `--format html`. |
| `status --domain …` | `status`; domain analytics are no longer included. |
| `scrape`, `rerun`, `results`, `result` | Use the MrScraper dashboard at https://app.mrscraper.com. |

## Programmatic API

The package exports credential helpers, the direct `request` helper, and the
functions behind each command:

```js
import {
  scraperApi,
  webSearchApi,
  getSubscriptionAccountApi,
  summarizeSubscriptionAccount,
} from "@mrscraper/cli";

const page = await scraperApi({ token: process.env.MRSCRAPER_API_KEY, url: "https://www.scrapethissite.com/pages/simple/" });
```

`scraperApi` and `webSearchApi` use the Python SDK's defaults, including
`webSearchApi`'s `raw: true` (result-page HTML); pass `raw: false` for parsed
JSON.

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

For local integration tests, API hosts may be overridden with `MRSCRAPER_API_BASE_URL`, `MRSCRAPER_FETCH_BASE_URL`, and `MRSCRAPER_SYNC_BASE_URL`.

## License

MIT — see [LICENSE](./LICENSE).
