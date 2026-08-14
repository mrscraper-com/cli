# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

Official command-line client for [MrScraper](https://app.mrscraper.com). It fetches page content, creates AI extraction scrapers, retrieves Google results, reruns saved scrapers, and reports account usage.

Web-data commands write JSON to stdout; setup and authentication commands use
human-readable output. `status` renders a dashboard in an interactive terminal
and automatically switches to JSON when redirected or piped. Progress and
deprecation notices use stderr, and failed API calls exit with a non-zero
status. Sensitive response headers, API-token fields, signed query parameters,
and credentials embedded in generated curl commands are redacted before
output.

## Install

Requires Node.js 20 or newer.

One interactive command installs the CLI globally, copies the MrScraper skill
pack, and registers the local MCP server in every supported agent harness
detected on the machine:

```bash
npx -y @mrscraper/cli@latest init --all
```

If no credential exists, this human-facing command securely asks for an API
key. Press Enter to skip the key and use `mrscraper login` for browser OAuth.
Neither the API key nor OAuth tokens are copied into an MCP client config.

Agents use the non-interactive form so setup never waits for secret input, then
launch browser login only when authentication is still missing:

```bash
npx -y @mrscraper/cli@latest init --all --yes
mrscraper auth status --json
mrscraper login
```

The agent keeps `mrscraper login` running while the user approves access in the
browser. In headless automation, set `MRSCRAPER_API_KEY` instead.

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
- [`mrscraper-fetch`](./skills/mrscraper-fetch/SKILL.md) — readable page content,
  output formats, rendering, and unblock escalation;
- [`mrscraper-scrape`](./skills/mrscraper-scrape/SKILL.md) — prompt/schema
  extraction and AI modes; and
- [`mrscraper-serp`](./skills/mrscraper-serp/SKILL.md) — query-first Google
  discovery and handoff to fetch or scrape.

After this branch is merged, the raw onboarding URL will be:

```text
https://raw.githubusercontent.com/mrscraper-com/cli/main/skills/mrscraper/SKILL.md
```

Copyable AI setup prompt:

```text
Install MrScraper for this coding agent. Detect the client from the environment,
then run `npx -y @mrscraper/cli@latest init --agent <client> --yes` yourself.
This installs the CLI, all four MrScraper skills, and the local MCP integration.
Never ask me to paste an API key into chat. Check `mrscraper auth status --json`;
if unauthenticated and this is a local interactive session, run `mrscraper login`,
keep it running, and let me approve the browser OAuth request. In a headless
session, tell me to configure MRSCRAPER_API_KEY instead. Start a new client
session if the newly registered MCP tools are not visible, then report which
MrScraper skills and MCP tools are available.
```

### Install for one agent

Use the same `npx` bootstrap for a specific agent. In an interactive terminal,
it securely asks for an API key and stores it in `~/.mrscraper/auth.json`:

```bash
# Claude Code
npx -y @mrscraper/cli@latest init --agent claude-code

# Cursor
npx -y @mrscraper/cli@latest init --agent cursor

# Codex
npx -y @mrscraper/cli@latest init --agent codex

# Grok Build
npx -y @mrscraper/cli@latest init --agent grok

# OpenCode
npx -y @mrscraper/cli@latest init --agent opencode

# Pi
npx -y @mrscraper/cli@latest init --agent pi

# Oh My Pi
npx -y @mrscraper/cli@latest init --agent omp
```

Press Enter without a key to skip authentication and run `mrscraper login`
later. A local agent may launch that command, keep it running, and wait for the
user to approve in the browser. Add `--yes` for unattended agents or automation
so bootstrap never waits for input. Native plugin marketplace installation is
intentionally not documented yet; the `npx` bootstrap already provides the
CLI, skills, and MCP integration.

### Bootstrap behavior

`mrscraper init` performs these steps:

1. installs its current version globally with npm;
2. reuses saved OAuth/API-key credentials, saves an explicitly supplied
   `--api-key`, securely asks an interactive human for a key, or leaves
   authentication for later with `--yes`;
3. detects supported harnesses and targets them in one `npx skills add` call;
   and
4. registers `npx -y @mrscraper/mcp@latest` as a local stdio MCP server for
   those harnesses. Pi also receives its required `pi-mcp-adapter` package.

The skill sources stay in this GitHub repository; they are not bundled in the
npm package. The `skills` installer controls the harness-specific global skill
location. Detection currently covers the seven verified harnesses: Claude Code,
Cursor, Codex, Grok Build, OpenCode, Pi, and Oh My Pi. Grok Build is recognized
at `GROK_HOME` or `~/.grok`. OpenCode is recognized at its XDG
configuration location, `~/.config/opencode`, or `~/.opencode`. OMP is installed
through the standard `~/.agents/skills` provider it supports because the
upstream `skills` installer does not currently expose an `omp` target.

Useful variants:

```bash
mrscraper init --agent codex --yes
mrscraper init --all --yes
mrscraper init --all --yes --dry-run
mrscraper setup skills
mrscraper setup skills --agent codex
mrscraper setup skills --agent grok
mrscraper setup mcp
mrscraper setup mcp --agent codex
```

`--all` installs only into detected harnesses. `setup skills` refreshes the
complete pack; `setup mcp` refreshes only MCP registration. Neither command
changes authentication. The bootstrap does not add templates or default
provider settings, and it never starts browser login implicitly. When no
credential already exists, authenticate later with `mrscraper login`.
Package-runner flags such as `npx -y` approve package execution only; they do
not authenticate the CLI.

## Authentication

Browser OAuth is the interactive default:

```bash
mrscraper login
mrscraper auth status
```

The CLI opens the MrScraper authorization page, receives a one-time code on an
ephemeral `127.0.0.1` callback, exchanges it with PKCE, and refreshes the saved
session automatically. Use `mrscraper login --no-open` to print the URL without
launching a browser. An agent may launch `mrscraper login` when the user and
browser are on the same machine, but the user must approve the request.

API keys remain supported for CI and other non-interactive environments:

```bash
mrscraper login --api-key "your-key"
export MRSCRAPER_API_KEY="your-key"
mrscraper fetch https://example.com --token "your-key"
```

Get API keys from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens). Avoid
putting secrets directly in shell history; environment variables are preferred
for automation.

Both authentication methods use `~/.mrscraper/auth.json` with directory mode
`0700` and file mode `0600`. The CLI and every locally registered stdio MCP
server read this same file and coordinate OAuth refreshes through the same
lock. Set `MRSCRAPER_HOME` to override the directory. The previous
`~/.config/mrscraper/credentials.json` API key is migrated on first use. Treat
`auth.json` like a password: never commit, print, or share it.

Authentication precedence is `--token`, `MRSCRAPER_API_KEY`,
`MRSCRAPER_API_TOKEN`, then `~/.mrscraper/auth.json`. OAuth access tokens are
sent only as `Authorization: Bearer`; API keys retain the legacy
`x-api-token` compatibility header. `mrscraper logout` attempts OAuth revocation
and always removes local credentials.

The backend endpoints and security behavior required by this client are
specified in [`OAUTH_BACKEND.md`](./OAUTH_BACKEND.md).

## Command Summary

```text
init    bootstrap the CLI, detected agent skill pack, and MCP integration
login   authenticate with browser OAuth or explicitly save an API key
auth    inspect the active local authentication method
logout  revoke OAuth when possible and remove local credentials
setup   install or refresh skills and MCP registration
fetch   return page content without a prompt
scrape  extract requested data using a prompt or schema
serp    return Google search results
status  return account usage and optional domain analytics
rerun   rerun an existing AI or manual scraper
results list stored runs
result  retrieve one stored run
```

The planned top-level `agent` and `manual` command groups are not included in this release. Existing agent modes and manual reruns remain available through `scrape --agent` and `rerun --type manual`.

## `fetch`

Fetch a page without an extraction prompt:

```bash
mrscraper fetch https://example.com
mrscraper fetch https://example.com --format html
mrscraper fetch https://example.com --format json
```

Formats:

- `markdown` is the default and converts the returned HTML into Markdown.
- `html` preserves the endpoint's HTML response.
- `json` returns a document containing the title, description, language, text, links, and images.

### Unblocker options

```bash
mrscraper fetch URL --unblock auto
mrscraper fetch URL --unblock always --geo id
mrscraper fetch URL --wait-for '.products' --homepage
```

| Option | Default | Description |
| --- | --- | --- |
| `--unblock <mode>` | `auto` | `auto`, `always`, or `never`. Auto starts with a direct request and retries with browser rendering when a likely block page is detected. |
| `--geo <code>` | — | ISO 3166-1 alpha-2 proxy country. |
| `--wait-for <selector>` | — | Wait for a CSS selector; browser rendering is enabled automatically. |
| `--homepage` | off | Visit the site's home page before the target. |
| `--block-resources` | off | Block non-essential resources. |
| `--retries <n>` | `3` | Maximum retries used by the escalated request. |
| `--token-cap <n>` | — | Maximum token usage across retries. |
| `--timeout <seconds>` | `30` | Page-load timeout. |
| `--format <format>` | `markdown` | `markdown`, `html`, or `json`. |
| `--token <key>` | — | Override configured authentication with an API key. |

Automatic escalation is implemented by this CLI around the existing Web Unblocker endpoint. It can detect common challenge pages, but no client-side detector can identify every site-specific block.

## `scrape`

Create an AI scraper with extraction instructions:

```bash
mrscraper scrape https://example.com/product \
  --prompt "Extract all available product information" \
  --output .mrscraper/example-product.json
```

`-o, --output <path>` creates parent directories and writes only the extracted
payload as pretty JSON. The full API response envelope remains on stdout for
backward compatibility. The output file is not created when the request fails,
the run is unfinished, or the response has no extracted payload.

Use a JSON Schema when the output contract must be explicit:

```bash
mrscraper scrape https://example.com/products \
  --schema ./product.schema.json

mrscraper scrape https://example.com/products \
  --prompt "Extract every product" \
  --schema ./product.schema.json
```

The schema is validated as JSON and appended to the natural-language message sent to the existing AI scraper API.

Existing agent modes remain supported:

```bash
mrscraper scrape URL --agent general --prompt "Extract the page"
mrscraper scrape URL --agent listing --prompt "Extract products" --max-pages 5
mrscraper scrape URL --agent map --max-depth 2 --max-pages 50 --limit 1000
```

| Option | Description |
| --- | --- |
| `-p, --prompt <text>` | Extraction instructions. |
| `--schema <path>` | JSON Schema file included in the extraction instructions. Not supported by the map agent. |
| `-o, --output <path>` | Write only the extracted payload as pretty JSON. |
| `-a, --agent <agent>` | Existing `general`, `listing`, or `map` mode. |
| `--proxy-country <code>` | Proxy country supported by the AI scraper API. |
| `--max-pages <n>` | Listing or map page limit. |
| `--max-depth <n>` | Map crawl depth. |
| `--limit <n>` | Map result limit. |
| `--include-patterns <regex>` | Map URL inclusion regex. |
| `--exclude-patterns <regex>` | Map URL exclusion regex. |
| `--token <key>` | Override configured authentication with an API key. |

The AI scraper endpoint does not accept browser rendering, selector waits, homepage navigation, retry caps, or token caps. Those options are therefore limited to `fetch`; structured scrape supports the endpoint's existing `--proxy-country` field.

For compatibility, promptless use still performs the old HTML fetch and prints a deprecation notice to stderr:

```bash
mrscraper scrape https://example.com
# Prefer: mrscraper fetch https://example.com --format html
```

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
| `--raw` | off | Backward-compatible alias for `--format html`. |
| `--timeout <seconds>` | `120` | Request timeout. |
| `--token <key>` | — | Override configured authentication with an API key. |

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
explicitly.

Add analytics for a domain and UTC date range:

```bash
mrscraper status --domain example.com
mrscraper status --domain example.com --from 7d
mrscraper status --domain example.com \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-10T00:00:00Z
```

The analytics API requires a domain. Without `--domain`, `status` returns only account, subscription, rate-limit, and token-usage information. API tokens and billing identifiers are removed from the output.

| Option | Default | Description |
| --- | --- | --- |
| `--domain <domain>` | — | Add scrape status analytics for this domain. |
| `--from <date-or-duration>` | `24h` | ISO 8601 start time or duration such as `30m`, `24h`, or `7d`. |
| `--to <date>` | `now` | ISO 8601 end time or `now`. |
| `--action <action>` | — | Optional action filter. |
| `--api-token-name <name>` | — | Optional API-token-name filter. |
| `--json` | automatic | Always print machine-readable JSON. |
| `--pretty` | automatic | Always render the account dashboard. |
| `--no-color` | off | Disable ANSI color in the dashboard. |
| `--token <key>` | — | Override configured authentication with an API key. |

## `rerun`

Existing AI, manual, and bulk reruns remain unchanged:

```bash
mrscraper rerun URL --type ai --scraper-id SCRAPER_UUID
mrscraper rerun URL --type manual --scraper-id SCRAPER_UUID
mrscraper rerun "https://a.example,https://b.example" \
  --bulk --type manual --id SCRAPER_UUID
```

Single reruns require `--scraper-id`. Bulk reruns require `--bulk` and `--id`.

## `results` and `result`

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search example.com --page 2
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
```

Use these commands to inspect work created by `scrape` or `rerun`.

## Programmatic API

The package exports its credential, request, conversion, status, SERP, and scraper helpers:

```js
import {
  fetchWithUnblockerApi,
  formatFetchResult,
  createAiScraperApi,
  googleSerpSyncApi,
  getSubscriptionAccountApi,
} from "@mrscraper/cli";
```

The legacy positional `fetchHtmlApi(token, url, timeout, geoCode, blockResources)` export remains available.

## Development

```bash
npm install
npm test
node bin/mrscraper.js --help
```

Run the complete package, skill, and MCP bootstrap smoke test inside Docker so
global npm and agent-directory writes stay out of the host environment:

```bash
docker build --file test/bootstrap.Dockerfile .
```

For local integration tests, API hosts may be overridden with `MRSCRAPER_API_BASE_URL`, `MRSCRAPER_FETCH_BASE_URL`, and `MRSCRAPER_SYNC_BASE_URL`.

## License

MIT — see [LICENSE](./LICENSE).
