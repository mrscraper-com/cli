---
name: mrscraper
description: Set up and operate the MrScraper CLI, including installation, authentication, command routing, output handling, account usage, and troubleshooting. Use for CLI-wide or multi-step work; use the focused command skills to scrape a known page or to search the web.
---

# MrScraper CLI

Use this skill for setup, authentication, command selection, shared output
handling, account status, and troubleshooting. Load the focused skill for the
command you run; each one lists that command's options and defaults.

The CLI has six scraping and search commands, plus account status:

| Command | Purpose | Skill |
| --- | --- | --- |
| `mrscraper scrape-html <url>` | Retrieve raw page HTML, optionally with a screenshot. | [mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) |
| `mrscraper scrape-markdown <url>` | Retrieve clean Markdown. | [mrscraper-scrape-markdown](../mrscraper-scrape-markdown/SKILL.md) |
| `mrscraper get-screenshot <url>` | Capture a full-page PNG screenshot. | [mrscraper-get-screenshot](../mrscraper-get-screenshot/SKILL.md) |
| `mrscraper scrape-brand <url>` | Extract a website's brand as JSON. | [mrscraper-scrape-brand](../mrscraper-scrape-brand/SKILL.md) |
| `mrscraper scrape-json <url>` | Extract structured JSON using a prompt. | [mrscraper-scrape-json](../mrscraper-scrape-json/SKILL.md) |
| `mrscraper web-search <query>` | Search the web using query text. | [mrscraper-web-search](../mrscraper-web-search/SKILL.md) |
| `mrscraper status` | Show the account's subscription, token usage, and limits. | This skill |

The commands send only the parameters documented in the
[Scraper API reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html).
Fixed request fields, such as `html=true` for Scrape HTML or `agent=general`
for Scrape JSON, are added automatically.

## Step 1 — Verify or Install MrScraper

Check whether the CLI is available:

```bash
command -v mrscraper && mrscraper --version
```

When an agent performs first-time setup, install the CLI and all seven skills
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
`https://mcp.mrscraper.com/mcp` and exposes the same seven services as tools.

## Step 2 — Authenticate

Inspect the available credential:

```bash
mrscraper auth status --json
```

A configured credential reports `credential_configured: true`. This command
reads local configuration only.

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

After credentials are configured, verify end-to-end access with the account
check, which does not retrieve a page:

```bash
mrscraper status --json
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
| Preserve a known page's markup for a parser, archive, or audit | [mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) with `mrscraper scrape-html` |
| Read, summarize, or quote a known page | [mrscraper-scrape-markdown](../mrscraper-scrape-markdown/SKILL.md) with `mrscraper scrape-markdown` |
| See how a page looks | [mrscraper-get-screenshot](../mrscraper-get-screenshot/SKILL.md) with `mrscraper get-screenshot` |
| Get a website's colors, fonts, logos, and social links | [mrscraper-scrape-brand](../mrscraper-scrape-brand/SKILL.md) with `mrscraper scrape-brand` |
| Extract named fields from one page | [mrscraper-scrape-json](../mrscraper-scrape-json/SKILL.md) with `mrscraper scrape-json` |
| Discover relevant pages from a search query | [mrscraper-web-search](../mrscraper-web-search/SKILL.md) with `mrscraper web-search`, then retrieve selected pages |
| Check the plan, token usage, or remaining tokens | `mrscraper status --json` |

### Retrieve first, extract locally

The CLI can return raw page content or extract JSON with `scrape-json`.
Produce summaries, tables, JSON, and other structured output from that content
with local analysis or extraction code.
The raw response preserves details for later questions, validation, and
changes to the requested schema.

For many pages that share a layout:

1. Retrieve representative pages and inspect their content;
2. Understand the shared structure and required fields;
3. Define a stable output schema and one local extraction implementation;
4. Retrieve the remaining pages, in parallel when safe and proportional; and
5. Run the same extractor across all saved responses.

Use `scrape-json --prompt` for AI extraction or derive structured data locally.
Request Markdown with `scrape-markdown` when readable text is enough, and HTML when
the extractor needs the page structure.

For discovery-first work, run `web-search`, select the relevant URLs, and
retrieve the pages whose content will inform the answer.

The CLI does not create AI scrapers, rerun saved scrapers, or list stored
results. Use the MrScraper dashboard at https://app.mrscraper.com for those.

## Step 4 — Handle Output and Artifacts

Data commands print JSON to stdout:

```json
{
  "status_code": 200,
  "data": {},
  "headers": {}
}
```

API failures exit nonzero and add `error`. Progress and diagnostics use
stderr. The `status` command also prints JSON in interactive terminals.

Save substantial artifacts under the current project's `./.mrscraper/`
folder:

```bash
mkdir -p ./.mrscraper
mrscraper scrape-html "https://www.scrapethissite.com/pages/simple/" \
  > ./.mrscraper/countries-page.json
mrscraper web-search "country population data" > ./.mrscraper/search.json
```

The project artifact folder `./.mrscraper/` is separate from the credential
folder `~/.mrscraper/`. Keep project artifacts out of version control unless
the user asks to commit them.

## Step 5 — Review Account Usage

Request machine-readable account status:

```bash
mrscraper status --json
```

The raw `/subscription-accounts` response body is preserved in the envelope's
`data` field, including all account fields returned by the API. The CLI does
not summarize, redact, or add calculated fields to this response.

### Status parameters

| Parameter | Default | Use |
| --- | --- | --- |
| `--json` | on | Print JSON (also the default without this flag). |
| `--token <key>` | configured credential | Override authentication. |

Check remaining tokens before a large batch of page retrievals.

## Step 6 — Troubleshoot

- **Unauthorized or 401** — run `mrscraper login` in a local interactive
  session or verify `MRSCRAPER_API_KEY` in automation.
- **CLI missing** — run the agent-safe `npx ... init` command from Step 1.
- **Skills missing** — run `mrscraper setup skills --dry-run`, then target the
  current harness with `--agent <id>`.
- **Page blocked, incomplete, or missing dynamic content** — load the
  command's focused skill, such as
  [mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md), and retry with
  page-loading options appropriate to the target.
- **Structured output is incomplete** — inspect the saved raw content and
  improve the local extraction logic.
- **Search results are weak** — load
  [mrscraper-web-search](../mrscraper-web-search/SKILL.md) and refine the
  query, country, or result count.
- **Unknown option or command** — run `mrscraper <command> --help`. The `fetch`,
  `scrape`, `serp`, `rerun`, `results`, and `result` commands were replaced by
  the six commands above and `status`. The old `scraper-api`, `scraperAPI`,
  `webSearch`, and `account` commands are removed; `account` is now `status`.
  The `--super`, `--wait-until`, `--proxy-country`, `--proxy`, and
  `--return-cookie` options were removed because the Scraper API reference no
  longer lists them.

## Limits

Use another tool for:

- Clicking controls, completing forms, or authenticated browser sessions;
- Parsing local PDFs, documents, spreadsheets, or other files;
- Recurring monitoring, notifications, or scheduling.

Explain the boundary and continue with any supported portion of the task.
