---
name: mrscraper
description: Set up and authenticate the MrScraper CLI, route tasks to page retrieval, Google web search, or account status, and handle shared output. Use the focused skills for each data operation.
---

# MrScraper CLI

The CLI has three data operations: `scraperAPI`, `webSearch`, and `account`.
Login and setup commands manage local configuration.

## Installation and authentication

For agent setup, install the CLI and skills without an interactive login:

```bash
npx -y @mrscraper/cli@latest init --all --yes --skip-auth
mrscraper auth status --json
```

`--yes` keeps bootstrap non-interactive. `--skip-auth` leaves authentication
for a separate step. If no credential is configured and the user is local,
run `mrscraper login` and keep the command running while the user approves
browser sign-in. The CLI exchanges the code for an API key and saves it in
`~/.mrscraper/auth.json`. Use `MRSCRAPER_API_KEY` in headless automation.
`MRSCRAPER_API_TOKEN` and explicit `--token` overrides are also supported.
Local `auth status` checks configuration; `account` verifies the remote account.

Refresh skills with `mrscraper setup skills`. Use `--agent <id>` to target
`claude-code`, `cursor`, `codex`, `grok`, `hermes`, `opencode`, `openclaw`,
`pi`, or `omp`. Add `--dry-run` to preview installation.

## Choose an operation

| Task | Skill |
| --- | --- |
| Read a known page as HTML, Markdown, or a screenshot | [mrscraper-scraper-api](../mrscraper-scraper-api/SKILL.md) |
| Find pages from a Google query or Google search URL | [mrscraper-web-search](../mrscraper-web-search/SKILL.md) |
| Check account identity, subscription, or remaining quota | [mrscraper-account](../mrscraper-account/SKILL.md) |

For discovery, search first, then retrieve the relevant result URLs. Preserve
raw page content when subsequent analysis or local extraction needs it.

## Output and artifacts

Page and search operations return `{ status_code, data, headers }`. Account
JSON places the normalized summary at `data.account`; use `account --json`
for machine-readable output even in an interactive terminal. HTTP or network
failures exit nonzero and include `error`; progress uses stderr.

Save requested artifacts in the current project's `./.mrscraper/` directory:

```bash
mkdir -p ./.mrscraper
mrscraper scraperAPI "https://books.toscrape.com/" --markdown > ./.mrscraper/page.json
mrscraper webSearch "web scraping best practices" > ./.mrscraper/search.json
mrscraper account --json
```

The project artifact directory is separate from `~/.mrscraper/` credentials.
Use `mrscraper <command> --help` for flags. For a 401 response, check configured
credentials or run browser login in a local session. The CLI does not create
saved extraction scrapers, rerun jobs, or retrieve stored results.
