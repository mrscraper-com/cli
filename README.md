# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

Official command-line client for [MrScraper](https://app.mrscraper.com). It fetches page content, creates AI extraction scrapers, retrieves Google results, reruns saved scrapers, and reports account usage.

Data commands write JSON to stdout; setup and authentication commands use
human-readable output. Progress and deprecation notices use stderr, and failed
API calls exit with a non-zero status. Sensitive response headers, API-token
fields, signed query parameters, and credentials embedded in generated curl
commands are redacted before output.

## Install

Requires Node.js 18 or newer.

For agent environments, one bootstrap command installs the CLI globally,
configures credentials, and installs the MrScraper skill into every supported
agent harness detected on the machine:

```bash
npx -y @mrscraper/cli@latest init --all
```

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

The bootstrap installs [`skills/mrscraper/SKILL.md`](./skills/mrscraper/SKILL.md)
through the public `skills` installer. The document teaches a new agent how to
authenticate, choose between `fetch`, `scrape`, and `serp`, reuse stored
scrapers, inspect results, recover from blocked pages, and handle CLI output
safely.

After this branch is merged, the raw onboarding URL will be:

```text
https://raw.githubusercontent.com/mrscraper-com/cli/main/skills/mrscraper/SKILL.md
```

### Bootstrap behavior

`mrscraper init` performs only these steps:

1. installs its current version globally with npm;
2. reuses an existing API key or prompts the human for one; and
3. detects supported harnesses and targets them in one `npx skills add` call.

The skill source stays in this GitHub repository; it is not bundled in the npm
package. The `skills` installer controls the harness-specific global skill
location. Detection currently covers Claude Code, Cursor, Windsurf, Codex,
Continue, Roo Code, Gemini CLI, GitHub Copilot, Droid, OpenCode, Pi, Oh My Pi,
OpenClaw, OpenHands, and Hermes Agent. OpenCode is recognized at its XDG
configuration location, `~/.config/opencode`, or `~/.opencode`. OMP is
installed through the standard `~/.agents/skills` provider it supports because
the upstream `skills` installer does not currently expose an `omp` target.

Useful variants:

```bash
mrscraper init --agent codex
mrscraper init --yes
mrscraper init --dry-run
mrscraper setup skills
mrscraper setup skills --agent codex
```

`--all` installs only into detected harnesses. `setup skills` refreshes the
skill without reinstalling the CLI or changing authentication. The bootstrap
does not install MCP configuration, templates, browser OAuth, or default
provider settings. `--yes` prevents prompting; when no credential already
exists, authenticate later with `mrscraper login`.

When `init` is launched through npx from a Git branch or local checkout, it
reuses that same source for both the global CLI and the agent skill. This keeps
branch testing from falling back to a registry version or the default branch.

## Authentication

Get an API key from [app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens), then use one of these methods:

```bash
mrscraper login
export MRSCRAPER_API_KEY="your-key"
mrscraper fetch https://example.com --token "your-key"
```

Authentication precedence is `--token`, `MRSCRAPER_API_KEY`, `MRSCRAPER_API_TOKEN`, then the saved credentials file. `mrscraper logout` removes the saved key.

## Command Summary

```text
init    bootstrap the CLI, credentials, and detected agent skills
setup   install or refresh the agent skill
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
| `--token <key>` | — | Override the configured API key. |

Automatic escalation is implemented by this CLI around the existing Web Unblocker endpoint. It can detect common challenge pages, but no client-side detector can identify every site-specific block.

## `scrape`

Create an AI scraper with extraction instructions:

```bash
mrscraper scrape https://example.com/products \
  --prompt "Extract product name, price, and availability"
```

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
| `-a, --agent <agent>` | Existing `general`, `listing`, or `map` mode. |
| `--proxy-country <code>` | Proxy country supported by the AI scraper API. |
| `--max-pages <n>` | Listing or map page limit. |
| `--max-depth <n>` | Map crawl depth. |
| `--limit <n>` | Map result limit. |
| `--include-patterns <regex>` | Map URL inclusion regex. |
| `--exclude-patterns <regex>` | Map URL exclusion regex. |
| `--token <key>` | Override the configured API key. |

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
| `--token <key>` | — | Override the configured API key. |

## `status`

Show subscription and token usage:

```bash
mrscraper status
```

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
| `--token <key>` | — | Override the configured API key. |

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

Run the complete package-and-skill smoke test inside Docker so global npm and
agent-directory writes stay out of the host environment:

```bash
docker build --file test/bootstrap.Dockerfile .
```

For local integration tests, API hosts may be overridden with `MRSCRAPER_API_BASE_URL`, `MRSCRAPER_FETCH_BASE_URL`, and `MRSCRAPER_SYNC_BASE_URL`.

## Compliance

Scrape only content you are authorized to access. Review the target site's terms and applicable privacy, copyright, and computer-access laws before collecting or reusing data, especially from authenticated pages.

## License

MIT — see [LICENSE](./LICENSE).
