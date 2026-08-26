# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

Official command-line client for [MrScraper](https://app.mrscraper.com). It fetches page content, creates AI extraction scrapers, retrieves Google results, reruns saved scrapers, and reports account usage.

Web-data commands return a consistent JSON envelope containing `status_code`,
the response in `data`, and non-sensitive response `headers`. The `status`
command combines account and optional analytics information into a concise
summary and renders a dashboard in an interactive terminal. Progress uses
stderr, and failed API calls exit non-zero.

## Install

Requires Node.js 20 or newer.

One interactive command installs the CLI globally and copies all four
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

The bootstrap installs four focused skills through the public `skills`
installer:

- [`mrscraper`](./skills/mrscraper/SKILL.md) — onboarding, authentication,
  routing, shared output rules, saved runs, status, troubleshooting, and limits;
- [`mrscraper-fetch`](./skills/mrscraper-fetch/SKILL.md) — page HTML and browser
  rendering controls;
- [`mrscraper-scrape`](./skills/mrscraper-scrape/SKILL.md) — prompt-based
  extraction, optional schema prompt guidance, and AI modes; and
- [`mrscraper-serp`](./skills/mrscraper-serp/SKILL.md) — query-first Google
  discovery and handoff to fetch or scrape.

Raw onboarding URL:

```text
https://raw.githubusercontent.com/mrscraper-com/cli/main/skills/mrscraper/SKILL.md
```

Copyable AI setup prompt:

```text
Install MrScraper for this coding agent. Detect the client from the environment,
then run `npx -y @mrscraper/cli@latest init --agent <client> --yes --skip-auth`
yourself. This installs the CLI and all four MrScraper skills without waiting
for authentication. Never ask me to paste an API key into chat. Check
`mrscraper auth status --json`; if no credential is configured and this is a local
interactive session, run `mrscraper login`, keep it running, and let me approve
the browser request. In a headless session, tell me to configure
MRSCRAPER_API_KEY instead. Then confirm the CLI works and report which
MrScraper skills were installed.
```

MrScraper also offers an optional hosted MCP server. It uses a separate bearer
API key connection; see [Hosted MCP](#hosted-mcp-optional).

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
3. Installs all four MrScraper skills.

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

MCP setup is separate from the CLI and skill bootstrap.
[Create an API key](https://app.mrscraper.com/api-tokens), then configure your
MCP client to send it as a bearer token:

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
mrscraper fetch https://www.scrapethissite.com/pages/simple/ --token "your-key"
```

Get API keys from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens). Avoid
putting secrets directly in shell history; environment variables are preferred
for automation.

## Command Summary

```text
init    bootstrap the CLI and detected agent skill pack
login   use browser sign-in or explicitly save an API key
auth    inspect local credential configuration without contacting the API
logout  remove local credentials
setup   install or refresh the skill pack
fetch   fetch page HTML with optional browser rendering
scrape  extract structured data or map site URLs
serp    return Google search results
status  return account usage and optional domain analytics
rerun   rerun an existing AI or manual scraper
results list stored runs
result  retrieve one stored run
```

## `fetch`

`fetch` is the CLI interface to MrScraper's
[Web Unblocker](https://docs.mrscraper.com/docs/features/unblocker). It retrieves
page HTML through `GET https://api.mrscraper.com/`. The response is available
in the CLI envelope's `data` field:

```bash
mrscraper fetch https://www.scrapethissite.com/pages/simple/

# Extract the HTML body
mrscraper fetch https://www.scrapethissite.com/pages/simple/ | jq -r '.data'
```

Enable browser rendering for JavaScript-dependent pages:

```bash
mrscraper fetch URL --browser-rendering
mrscraper fetch URL --browser-rendering --wait-for-selector '.products'
mrscraper fetch URL --browser-rendering --geo-code ID --home-page
```

| CLI option | API query field | Default sent | Behavior |
| --- | --- | --- | --- |
| `<url>` | `url` | required | Target page URL. |
| `--browser-rendering` | `browserRendering` | `false` | Load the page in a browser and execute JavaScript. |
| `--geo-code <code>` | `geoCode` | omitted | Route through the requested ISO 3166-1 alpha-2 country. |
| `--wait-for-selector <selector>` | `waitForSelector` | omitted | Wait for a CSS selector; the CLI requires explicit `--browser-rendering`. |
| `--home-page` | `homePage` | `false` | Visit the site's root before the target page. |
| `--block-resources` | `blockResources` | `false` | Block non-essential browser resources when supported by the selected proxy. |
| `--max-retries <n>` | `maxRetries` | `3` | Set the maximum retry attempts after a failed request. Zero is accepted. |
| `--token-cap <n>` | `tokenCap` | omitted | Limit the running plan-token total used to decide whether another retry may run. The initial request always runs. |
| `--timeout <seconds>` | `timeout` | `30` | Set the page-load timeout. The command allows another 30 seconds to receive the response. |
| `--token <key>` | authentication header | configured credential | Override authentication for this command. |

Start with the default request. Add browser rendering for JavaScript-driven
content, a selector wait for delayed elements, geographic routing for localized
content, or homepage navigation when the target site requires it. Unblocker
usage is calculated from runtime and bandwidth: one plan token per 30 seconds
and one plan token per 0.2 MB, rounded up per component. Resource blocking can
reduce bandwidth for text-focused pages. Use `--max-retries` and `--token-cap`
to balance recovery from temporary failures with usage. See the
[Token Plan](https://docs.mrscraper.com/docs/getting-started/api-token) for the
complete calculation.

## `scrape`

Call `POST /api/v1/scrapers-ai`. The default `general` agent and the `listing`
agent require an extraction prompt:

```bash
mrscraper scrape https://www.scrapethissite.com/pages/simple/ \
  --prompt "Extract each country's name, capital, population, and area" \
  --output .mrscraper/countries.json
```

`-o, --output <path>` creates parent directories and writes the extracted
`data.data.data` value as pretty JSON. The complete response remains on stdout.
The file is created after a completed extraction returns data.

`--schema-prompt` reads a local JSON Schema object and adds it to the extraction
instructions as best-effort shape guidance. Validate the saved result
separately when strict schema compliance is required:

```bash
mrscraper scrape https://www.scrapethissite.com/pages/simple/ \
  --prompt "Extract every country" \
  --schema-prompt ./countries.schema.json
```

Existing agent modes remain supported:

```bash
mrscraper scrape URL --agent general --prompt "Extract the page"
mrscraper scrape URL --agent listing --prompt "Extract products" --max-pages 5
mrscraper scrape URL --agent map --max-depth 2 --max-pages 50 --limit 1000
```

### Reproduce a scrape with `rerun`

Every successful `scrape` creates a saved AI scraper configuration by default.
The complete stdout response contains its UUID at `data.data.scraperId`. Keep
that UUID to run the same saved extraction configuration against the original
URL or a new URL without rebuilding the prompt and agent settings:

```bash
mrscraper scrape "https://www.scrapethissite.com/pages/forms/?page_num=1" \
  --prompt "Extract each hockey team's name, year, wins, and losses" \
  --output .mrscraper/hockey-teams-page-1.json \
  > .mrscraper/hockey-teams-run.json

SCRAPER_UUID=$(jq -r '.data.data.scraperId' .mrscraper/hockey-teams-run.json)
mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=2" \
  --type ai \
  --scraper-id "$SCRAPER_UUID"
```

The `--output` file contains only the extracted value, so retain the stdout
response when the scraper UUID will be needed later. Reproducible means the
saved configuration can be reused; page changes and model behavior can still
change the returned data.

`rerun` also supports dashboard-built manual workflows and asynchronous bulk
jobs across multiple target URLs. See the full [`rerun`](#rerun) section below
for the available modes and result-tracking workflow.

| Option | Description |
| --- | --- |
| `-p, --prompt <text>` | Extraction instructions. |
| `--schema-prompt <path>` | Best-effort JSON Schema guidance added to `message`; general/listing only. |
| `-o, --output <path>` | Write `data.data.data` as pretty JSON. |
| `-a, --agent <agent>` | Select `general`, `listing`, or `map`; defaults to `general`. |
| `--proxy-country <code>` | API `proxyCountry`; general/listing only. |
| `--max-pages <n>` | API `maxPages`; listing/map only. The service default applies when omitted. |
| `--max-depth <n>` | API `maxDepth`; map only and omitted when not supplied. |
| `--limit <n>` | API `limit`; map only and omitted when not supplied. |
| `--include-patterns <regex>` | API `includePatterns`; map only. |
| `--exclude-patterns <regex>` | API `excludePatterns`; map only. |
| `--token <key>` | Override configured authentication with an API key. |

Use crawl limits and URL patterns with the map agent. Prompts, schema guidance,
and proxy country selection apply to general and listing.

## `serp`

Scrape Google using either a plain query or an existing search URL:

```bash
mrscraper serp "iphone 17"
mrscraper serp "running shoes" --region id --language id --page 2
mrscraper serp "https://www.google.com/search?q=iphone+17&gl=us&hl=en"
mrscraper serp "iphone 17" --format html --render-js
```

| Option | Default | Description |
| --- | --- | --- |
| `--region <code>` | — | Google result country. |
| `--language <code>` | — | Google result language. |
| `--page <n>` | — | Result page number. |
| `--format <format>` | `json` | Parsed `json` or raw-page `html`. |
| `--render-js` | off | Wait for JavaScript, including AI Overview. |
| `--raw` | off | Deprecated alias for `--format html`. |
| `--client-timeout <seconds>` | `120` | Set the command's HTTP request deadline. |
| `--token <key>` | — | Override configured authentication with an API key. |

A complete Google search URL is parsed into the request's `query`, `region`,
`language`, and `page` fields.

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

Add analytics for a domain and UTC date range:

```bash
mrscraper status --domain www.scrapethissite.com
mrscraper status --domain www.scrapethissite.com --from 7d
mrscraper status --domain www.scrapethissite.com \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-10T00:00:00Z
```

With `--domain`, the CLI makes a second request to `/analytic/statuses`,
normalizes a URL to its hostname, converts relative dates locally, and merges
the response into the summary. Without `--domain`, only the subscription
request is made.

| Option | Default | Description |
| --- | --- | --- |
| `--domain <domain>` | — | Add scrape status analytics for this domain. |
| `--from <date-or-duration>` | `24h` | ISO 8601 start time or duration such as `30m`, `24h`, or `7d`. |
| `--to <date>` | `now` | ISO 8601 end time or `now`. |
| `--action <action>` | — | Optional action filter. |
| `--api-token-name <name>` | — | Optional API-token-name filter. |
| `--json` | automatic | Print the account summary as JSON. |
| `--pretty` | automatic | Always render the account dashboard. |
| `--no-color` | off | Disable ANSI color in the dashboard. |
| `--token <key>` | — | Override configured authentication with an API key. |

## `rerun`

`--type` and `--bulk` answer two separate questions:

- Use `--type ai` for a saved AI scraper created by `mrscraper scrape`.
- Use `--type manual` for a saved step-based workflow created in the MrScraper
  dashboard. The CLI can run that workflow but does not create it.
- Omit `--bulk` to run the saved scraper on one URL. Add `--bulk` to apply the
  same scraper configuration to a comma- or newline-separated URL list in one
  bulk request.

Manual reruns can be single or bulk, and bulk reruns can use either an AI or a
manual scraper.

Bulk mode submits one asynchronous backend job; the CLI does not call the
single-URL endpoint repeatedly. Save `data.data.bulkResultId` from the response
and inspect it until completion:

```bash
mrscraper result --id BULK_RESULT_UUID
```

The CLI selects one of four endpoints from `--type` and `--bulk`:

| Mode | Endpoint |
| --- | --- |
| Single AI | `POST /api/v1/scrapers-ai-rerun` |
| Bulk AI | `POST /api/v1/scrapers-ai-rerun/bulk` |
| Single manual | `POST /api/v1/scrapers-manual-rerun` |
| Bulk manual | `POST /api/v1/scrapers-manual-rerun/bulk` |

```bash
mrscraper rerun URL --type ai --scraper-id SCRAPER_UUID
mrscraper rerun URL --type manual --scraper-id SCRAPER_UUID
mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=1,https://www.scrapethissite.com/pages/forms/?page_num=2" \
  --bulk --type manual --id SCRAPER_UUID
```

Single reruns require `--scraper-id`. Bulk reruns require `--bulk` and `--id`,
and split `<target>` on commas or newlines. The single AI endpoint receives
`--max-depth` (`2`), `--max-pages` (`50`), `--limit` (`1000`), and the include
and exclude patterns (empty strings) as defaults. These crawl controls apply
only to single AI reruns.

## `results` and `result`

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search scrapethissite.com --page 2
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
```

Use these commands to inspect work created by `scrape` or `rerun`.

## Programmatic API

The package exports credential, direct request, status, SERP, and scraper
helpers. `fetchContentApi` is the fetch helper used by the CLI:

```js
import {
  fetchContentApi,
  createAiScraperApi,
  googleSerpSyncApi,
  getSubscriptionAccountApi,
} from "@mrscraper/cli";
```

The positional `fetchHtmlApi(token, url, timeout, geoCode, blockResources)`
compatibility export uses a 30-second timeout and no default geography.

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
