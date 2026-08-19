---
name: mrscraper
description: |
  Install, authenticate, route, and troubleshoot the MrScraper CLI, and use its saved scraper, result, and account commands. Use when an agent needs to set up MrScraper, choose the correct web-data command, rerun an AI or manual scraper, inspect stored results, check subscription usage, or handle work spanning multiple MrScraper capabilities. Route known-URL page reading to mrscraper-fetch, structured extraction to mrscraper-scrape, and query-first Google discovery to mrscraper-serp. Do not use for interactive browser actions, local document parsing, recurring monitoring, scheduling, or manual scraper creation.
---

# MrScraper CLI

Use this skill for setup, authentication, command selection, shared output
handling, saved reruns, stored results, account status, and troubleshooting.
Load the focused fetch, scrape, or SERP skill for those workflows.

## Step 1 — Verify or Install MrScraper

Check whether the CLI is available:

```bash
command -v mrscraper && mrscraper --version
```

When an agent performs first-time setup, install the CLI and all four skills
without starting an interactive authentication step:

```bash
npx -y @mrscraper/cli@latest init --all --yes --skip-auth
```

The flags have separate purposes:

- `npx -y` approves npm package execution.
- `--yes` keeps bootstrap non-interactive.
- `--skip-auth` leaves login for the next step.
- `--all` installs skills for supported harnesses detected on the machine.

### Bootstrap parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--api-key <key>` | omitted | Save a supplied API key during bootstrap. Agents should use `--skip-auth` and handle login separately. |
| `--all` | detected harnesses | Install skills for every supported harness found on the machine. |
| `--agent <id>` | omitted | Install skills for one supported harness. |
| `-y, --yes` | off | Keep bootstrap non-interactive. |
| `--skip-install` | off | Skip global CLI installation. |
| `--skip-auth` | off | Leave authentication for a separate login step. |
| `--skip-skills` | off | Skip skill-pack installation. |
| `--dry-run` | off | Print planned actions without changing the system. |

To target one harness, use its MrScraper ID:

| Harness | ID |
| --- | --- |
| Claude Code | `claude-code` |
| Cursor | `cursor` |
| Codex | `codex` |
| Grok Build | `grok` |
| Hermes Agent | `hermes` |
| OpenCode | `opencode` |
| OpenClaw | `openclaw` |
| Pi | `pi` |
| Oh My Pi | `omp` |

```bash
npx -y @mrscraper/cli@latest init --agent codex --yes --skip-auth
```

Refresh the skill pack without reinstalling the CLI:

```bash
mrscraper setup skills
mrscraper setup skills --agent codex
mrscraper setup skills --dry-run
```

`setup skills` accepts `--all` for detected harnesses, `--agent <id>` for one
harness, and `--dry-run` to preview the installation.

The bootstrap installs the CLI and skills. MCP is available separately at
`https://mcp.mrscraper.com/mcp` and uses bearer API-key configuration.

## Step 2 — Authenticate

Inspect the available credential:

```bash
mrscraper auth status --json
```

A configured credential reports `credential_configured: true`. This command
reads local configuration.

A `credential_configured: false` result means the CLI is not authenticated. On
a local interactive machine, start browser login so the CLI can be used right
away:

```bash
mrscraper login
```

Keep the command running while the user approves the browser request. Browser
login waits up to three minutes and stores the resulting API key under
`~/.mrscraper/auth.json`, or under `MRSCRAPER_HOME` when configured.

For CI, containers, or headless automation, use `MRSCRAPER_API_KEY`. A human
can also store a key outside the agent conversation:

```bash
mrscraper login --api-key "<key>"
```

After credentials are configured, verify end-to-end access with one small
scrape:

```bash
mrscraper scrape "https://example.com" \
  --prompt "Extract the page title"
```

Treat a successful command as confirmation that the CLI can authenticate and
reach the service. If it fails, report the error and do not claim setup is
complete.

### Login parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--api-key <key>` | omitted | Save an API key instead of opening browser login. |
| `--token <key>` | omitted | Deprecated alias for login's `--api-key`. |
| `--no-browser` | off | Prompt an interactive human for an API key. |
| `--no-open` | off | Print the browser URL while keeping the callback listener active. |
| `--timeout <seconds>` | `180` | Set the browser callback wait time. |

Credential precedence for API commands is:

1. Command option `--token`;
2. Environment variable `MRSCRAPER_API_KEY`;
3. Environment variable `MRSCRAPER_API_TOKEN`; and
4. Saved credential `~/.mrscraper/auth.json`.

Never ask the user to paste an API key into chat, print credentials, or commit
credential files. Use `mrscraper logout` to remove saved local credentials.

## Step 3 — Route the Request

| User outcome | Command or skill |
| --- | --- |
| Read, summarize, cite, inspect, or archive a known URL, including a protected or JavaScript-driven page | [mrscraper-fetch](../mrscraper-fetch/SKILL.md) |
| Extract fields, listings, records, tables, or site URLs from a known URL | [mrscraper-scrape](../mrscraper-scrape/SKILL.md) |
| Discover relevant pages from a Google query | [mrscraper-serp](../mrscraper-serp/SKILL.md) |
| Reproduce a prior scrape or run an existing AI/manual scraper on new URLs | `mrscraper rerun` |
| List or retrieve stored results | `mrscraper results` or `mrscraper result` |
| Check account usage or domain request outcomes | `mrscraper status` |

When “scrape this page” is ambiguous, choose from the requested output:

- Page content for reading or summarization → fetch;
- Selected fields, records, or JSON → scrape;
- Relevant URLs from a topic or query → SERP.

For discovery-first work, run SERP, select the relevant URLs, and then load the
fetch or scrape skill for those pages.

## Step 4 — Handle Output and Artifacts

Data commands print JSON to stdout. A typical response is:

```json
{
  "status_code": 200,
  "data": {},
  "headers": {}
}
```

API failures exit nonzero and add `error`. Progress and diagnostics use
stderr. Request `status --json` explicitly because an interactive terminal
otherwise displays the account dashboard.

Save substantial artifacts under the current project's `./.mrscraper/`
folder:

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://example.com/page" > ./.mrscraper/page.json
mrscraper scrape "https://example.com/listing" \
  --prompt "Extract all available listing information" \
  --output ./.mrscraper/listing.json
mrscraper serp "example search query" > ./.mrscraper/search.json
```

The project artifact folder `./.mrscraper/` is separate from the credential
folder `~/.mrscraper/`. Keep project artifacts out of version control unless
the user asks to commit them.

## Step 5 — Rerun Saved Scrapers

A successful `mrscraper scrape` creates a saved AI scraper configuration by
default. Read its UUID from `data.data.scraperId` in the stdout response and
use `rerun --type ai --scraper-id <uuid>` to apply the same saved extraction
configuration to the same or another URL. Prefer this over rebuilding a prompt
when the user wants a repeatable version of an earlier scrape.

The `scraperId` makes the configuration reusable, but it does not guarantee
identical extracted values when the source page or model behavior changes.

Choose a rerun mode:

| Mode | Required ID | URL input | Crawl controls |
| --- | --- | --- | --- |
| Single AI | `--scraper-id` | One URL | Supported |
| Single manual | `--scraper-id` | One URL | Not used |
| Bulk AI | `--bulk --id` | Comma- or newline-separated URLs | Not used |
| Bulk manual | `--bulk --id` | Comma- or newline-separated URLs | Not used |

Examples:

```bash
mrscraper rerun "https://example.com/product" \
  --type ai \
  --scraper-id SCRAPER_UUID

mrscraper rerun "https://example.com/product" \
  --type manual \
  --scraper-id SCRAPER_UUID

mrscraper rerun "https://a.example,https://b.example" \
  --bulk \
  --type manual \
  --id SCRAPER_UUID
```

Single AI crawl controls and defaults:

| Parameter | Default | Use |
| --- | --- | --- |
| `--max-depth <n>` | `2` | Map crawl depth. |
| `--max-pages <n>` | `50` | Maximum pages. |
| `--limit <n>` | `1000` | Maximum results. |
| `--include-patterns <regex>` | `""` | Include matching URLs. |
| `--exclude-patterns <regex>` | `""` | Exclude matching URLs. |
| `--token <key>` | configured credential | Override authentication. |

Use a saved manual scraper only after it has been created in MrScraper.

## Step 6 — Inspect Stored Results

List result rows:

```bash
mrscraper results --page-size 20 --page 1
mrscraper results --search example.com
mrscraper results --sort-field updatedAt --sort-order desc
```

### Results parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--sort-field <field>` | `updatedAt` | Field used to sort rows. |
| `--sort-order <asc\|desc>` | `desc` | Sort direction. |
| `--page-size <n>` | `10` | Rows per page. |
| `--page <n>` | `1` | 1-based page number. |
| `--search <query>` | omitted | Search filter. |
| `--date-range-column <column>` | omitted | Column used by the time range. |
| `--start-at <iso>` | omitted | Inclusive range start. |
| `--end-at <iso>` | omitted | Inclusive range end. |
| `--token <key>` | configured credential | Override authentication. |

Retrieve one row by positional ID or `--id`:

```bash
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
```

## Step 7 — Review Account Usage

Request machine-readable account status:

```bash
mrscraper status --json
```

Add domain request outcomes and a time range:

```bash
mrscraper status --json --domain example.com --from 7d --to now
```

### Status parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--domain <domain-or-url>` | omitted | Add request outcomes for a hostname. |
| `--from <date-or-duration>` | `24h` | ISO start or duration such as `30m`, `24h`, or `7d`. |
| `--to <date>` | `now` | ISO end time or `now`. |
| `--action <action>` | empty string | Filter outcomes by action. Used with `--domain`. |
| `--api-token-name <name>` | empty string | Filter outcomes by API token name. Used with `--domain`. |
| `--json` | automatic when piped | Print JSON. Agents should include it. |
| `--pretty` | automatic in a terminal | Print the account dashboard. |
| `--no-color` | off | Disable dashboard color. |
| `--token <key>` | configured credential | Override authentication. |

Domain outcomes describe MrScraper requests. They are not traffic, audience,
SEO, or market analytics.

## Step 8 — Troubleshoot

- **Unauthorized or 401** — run `mrscraper login` in a local interactive
  session or verify `MRSCRAPER_API_KEY` in automation.
- **CLI missing** — run the agent-safe `npx ... init` command from Step 1.
- **Skills missing** — run `mrscraper setup skills --dry-run`, then target the
  current harness with `--agent <id>`.
- **Page blocked or incomplete** — load
  [mrscraper-fetch](../mrscraper-fetch/SKILL.md) and retry with the page-loading
  options appropriate to the target.
- **Extraction is incomplete** — load
  [mrscraper-scrape](../mrscraper-scrape/SKILL.md) and improve the prompt,
  agent choice, or limits.
- **Search results are weak** — load
  [mrscraper-serp](../mrscraper-serp/SKILL.md) and refine the query, locale, or
  page.
- **Unknown option** — run `mrscraper <command> --help`.

## Limits

Use another tool for:

- Clicking controls, completing forms, or authenticated browser sessions;
- Parsing local PDFs, documents, spreadsheets, or other files;
- Recurring monitoring, notifications, or scheduling.

Explain the boundary and continue with any supported portion of the task.
