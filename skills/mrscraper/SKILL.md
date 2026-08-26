---
name: mrscraper
description: Set up and operate the MrScraper CLI, including installation, authentication, command routing, saved scraper reruns, stored results, account usage, and cross-capability troubleshooting. Use for CLI-wide or multi-capability work; use the focused skills for fetching known URLs, managed extraction, or Google discovery.
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
fetch:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/simple/"
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
| Acquire and preserve raw content from known public URLs for any downstream task | [mrscraper-fetch](../mrscraper-fetch/SKILL.md), preferably first |
| Add backend structured extraction, repeated records, site mapping, schema guidance, or a reusable scraper | [mrscraper-scrape](../mrscraper-scrape/SKILL.md), normally after or alongside fetch |
| Discover relevant pages from a Google query | [mrscraper-serp](../mrscraper-serp/SKILL.md), then fetch selected pages |
| Reproduce a prior scrape or run an existing AI/manual scraper on new URLs | `mrscraper rerun` |
| List or retrieve stored results | `mrscraper results` or `mrscraper result` |
| Check account usage or domain request outcomes | `mrscraper status` |

### Fetch-first principle

For agent-led work, always use `fetch` for the first exploration of a known URL.
The raw response provides full page context and preserves details for later
questions, validation, and custom processing.

The `general` and `listing` scrape modes send page content through a backend
LLM. Their output is shaped by the extraction prompt and may omit information.
Applying those modes across many pages also repeats model work that an agent can
usually replace with one reusable local extraction implementation.

Prefer this workflow:

1. Fetch representative pages and inspect their raw content;
2. Understand the shared page structure and required fields;
3. Define a stable output schema and local extraction implementation;
4. Fetch the remaining pages, in parallel when safe; and
5. Run the same extractor across all saved responses.

For a hundred same-layout pages, this means one hundred fetches followed by one
local batch extraction, rather than backend LLM extraction repeated across one
hundred pages. The raw inputs remain available if the schema changes or a field
needs to be recovered later.

Use `scrape` only when the user explicitly requests managed extraction or when,
after fetch-led exploration, it still provides a clear benefit. Even then,
retain the fetched source and verify important values against it. A request for
JSON, a table, or named fields is not by itself a reason for an agent to use
`scrape`; those outputs can be produced locally from the raw content.

The `map` agent is separate URL-discovery functionality. Use it when bounded
site mapping is actually needed, then fetch the pages whose content matters.

For discovery-first work, run SERP, select the relevant URLs, fetch the pages
whose content will inform the answer, and add scrape only when a derived
structured view is useful.

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

The scrape command below illustrates an explicit managed-extraction case. For
ordinary agent-led work, keep the fetched source and produce the requested
output with local analysis or extraction code.

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" \
  > ./.mrscraper/countries-source.json
mrscraper scrape "https://www.scrapethissite.com/pages/simple/" \
  --prompt "Extract each country's name, capital, population, and area as structured JSON" \
  --output ./.mrscraper/countries-extracted.json
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

When applying a saved configuration to a new target, prefer fetching that
target before the rerun when preserving or verifying its source content would
help. For bulk jobs, fetch representative or high-value targets instead of
automatically duplicating the entire job unless the requested coverage warrants
it.

The `scraperId` makes the configuration reusable, but it does not guarantee
identical extracted values when the source page or model behavior changes.

Choose the scraper type and target count independently:

1. Use `--type ai` for a saved AI scraper created by `mrscraper scrape`.
2. Use `--type manual` for a saved step-based workflow created in the
   MrScraper dashboard. Do not try to create a manual scraper with this CLI.
3. Omit `--bulk` for one URL. Add `--bulk` to apply the same saved
   configuration to a comma- or newline-separated URL list in one request.

Do not treat manual as meaning single or bulk as meaning manual. Both scraper
types support single and bulk reruns:

| Mode | Required ID | URL input | Crawl controls |
| --- | --- | --- | --- |
| Single AI | `--scraper-id` | One URL | Supported |
| Single manual | `--scraper-id` | One URL | Not used |
| Bulk AI | `--bulk --id` | Comma- or newline-separated URLs | Not used |
| Bulk manual | `--bulk --id` | Comma- or newline-separated URLs | Not used |

Treat a bulk rerun as one asynchronous backend job, not as repeated local
single-URL calls. Read `data.data.bulkResultId` from the submission response,
then call `mrscraper result --id <bulk-result-uuid>` until the stored result is
finished. Do not present the initial running response as completed data.

Examples:

```bash
mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=1" \
  --type ai \
  --scraper-id SCRAPER_UUID

mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=1" \
  --type manual \
  --scraper-id SCRAPER_UUID

mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=1,https://www.scrapethissite.com/pages/forms/?page_num=2" \
  --bulk \
  --type manual \
  --id SCRAPER_UUID
```

Single AI rerun controls:

| Parameter | Default | Use |
| --- | --- | --- |
| `--max-depth <n>` | saved scraper/backend default | Map crawl depth. |
| `--max-pages <n>` | saved scraper/backend default | Maximum pages. |
| `--limit <n>` | saved scraper/backend default | Maximum results. |
| `--include-patterns <regex>` | saved scraper/backend default | Include matching URLs. |
| `--exclude-patterns <regex>` | saved scraper/backend default | Exclude matching URLs. |
| `--proxy-country <code>` | saved scraper/backend default | Route the AI rerun through a country. |
| `--max-retry <n>` | saved scraper/backend default | Override the AI retry count. |
| `--timeout <seconds>` | saved scraper/backend default | Override the listing rerun timeout. |
| `--token <key>` | configured credential | Override authentication. |

The CLI sends only controls explicitly supplied by the caller. Omitting them
preserves the saved scraper and backend defaults.

Use a saved manual scraper only after it has been created in the MrScraper
dashboard.

## Step 6 — Inspect Stored Results

List result rows:

```bash
mrscraper results --page-size 20 --page 1
mrscraper results --search scrapethissite.com
mrscraper results --sort-field updatedAt --sort-order desc
mrscraper results --scraper-id SCRAPER_UUID --status Finished --type Rerun-AI
mrscraper results --url "https://www.scrapethissite.com/pages/forms/?page_num=2"
```

### Results parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--sort-field <field>` | `updatedAt` | Field used to sort rows. |
| `--sort-order <asc\|desc>` | `desc` | Sort direction. |
| `--page-size <n>` | `10` | Rows per page. |
| `--page <n>` | `1` | 1-based page number. |
| `--search <query>` | omitted | Search filter. |
| `--scraper-id <uuid>` | omitted | Exact saved scraper UUID filter. |
| `--status <status>` | omitted | Exact `Draft`, `Finished`, `Running`, `Failed`, or `Cancelled` filter. |
| `--type <type>` | omitted | Exact result-origin filter such as `AI` or `Rerun-AI`. |
| `--url <url>` | omitted | Exact stored target URL filter. |
| `--date-range-column <column>` | omitted | Column used by the time range. |
| `--start-at <iso>` | omitted | Inclusive range start. |
| `--end-at <iso>` | omitted | Inclusive range end. |
| `--token <key>` | configured credential | Override authentication. |

Retrieve one row by positional ID or `--id`:

```bash
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
mrscraper result --id RESULT_UUID --no-include-html
```

Result detail includes stored HTML by default. Use `--no-include-html` for a
smaller response when only status, metadata, or extracted data is needed.

A stored extraction is a derived snapshot. When checking completeness,
currentness, or a disputed value, fetch the recorded source URL and compare the
raw page with the stored result.

## Step 7 — Review Account Usage

Request machine-readable account status:

```bash
mrscraper status --json
```

Add domain request outcomes and a time range:

```bash
mrscraper status --json --domain www.scrapethissite.com --from 7d --to now
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
- **Page blocked or incomplete or missing dynamic content** — load
  [mrscraper-fetch](../mrscraper-fetch/SKILL.md) and retry with page-loading
  options appropriate to the target.
- **Structured output is incomplete** — inspect the fetched raw content and
  improve the local extraction logic first. If the user explicitly requested
  managed scrape, load [mrscraper-scrape](../mrscraper-scrape/SKILL.md) and
  improve the prompt, schema, agent choice, or limits.
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
