---
name: mrscraper
description: |
  MrScraper gives AI agents reliable, low-friction web scraping from the
  terminal. One command installs the `mrscraper` CLI, which can fetch
  rendered HTML, create AI scrapers (general / listing / map), rerun a
  saved scraper on new URLs (single or bulk), and read stored results.
  All commands print JSON to stdout, so agents can pipe straight into
  `jq` or parse output as-is.
---

# MrScraper

MrScraper is a web scraping platform. The `@mrscraper/cli` package wraps
the platform's HTTP API behind a single `mrscraper` command so an agent
can:

- fetch fully-rendered HTML for a URL (synchronous), or
- create an AI scraper that extracts structured data from a prompt
  (asynchronous — poll via `results` / `result`), or
- rerun a saved scraper on new URLs (single or bulk).

Every command prints a JSON object to stdout. Errors are returned as
JSON with an `error` field and a non-zero exit code, never as freeform
text.

## Install

Requires **Node.js 18+**. Install once, globally:

```bash
npm install -g @mrscraper/cli
mrscraper --help
```

Or invoke without installing:

```bash
npx --yes @mrscraper/cli --help
npx --yes @mrscraper/cli scrape "https://example.com/"
```

Verify the install is wired up:

```bash
mrscraper --version
mrscraper --help
```

## Authentication

You need an API key from <https://app.mrscraper.com/api-tokens>. The CLI
picks up the key in this order (first wins):

1. `--token <key>` passed on the command itself
2. `MRSCRAPER_API_KEY` env var (alias: `MRSCRAPER_API_TOKEN`)
3. Saved credentials file (written by `mrscraper login` / `init`)

If none are set, commands that hit the API exit with a clear error
message pointing at the token page.

**Pick the right auth method for the situation:**

- **Local development / repeated use** → `mrscraper login` (prompts for
  the key, saves it to disk, chmod 600). Best when the human is at the
  terminal — they paste the key once and the agent never sees it.
- **CI / scripts** → `mrscraper login --api-key "$MRSCRAPER_API_KEY"`
  non-interactively, OR just export `MRSCRAPER_API_KEY` and skip
  `login` entirely.
- **One-off / multi-tenant** → pass `--token <key>` on each command.
- **Project-scoped** → put `MRSCRAPER_API_KEY=...` in a `.env` file in
  the working directory; the CLI auto-loads it via dotenv.

The CLI loads `.env` from the **current working directory**, so the env
var resolves before the saved credentials file.

Credential file path:

| OS | Path |
|----|------|
| macOS / Linux | `$XDG_CONFIG_HOME/mrscraper/credentials.json` if set, else `~/.config/mrscraper/credentials.json` |
| Windows | `%LOCALAPPDATA%\mrscraper\credentials.json` (falls back to `%APPDATA%`) |

The file is JSON: `{"api_key": "..."}`. `mrscraper logout` deletes it.

## Choose Your Path

Pick the path that matches what you're trying to do. **Don't pick more
than one.** Each path tells you which command to run and how to read the
response.

- **Just need the raw HTML of a page** → Path A (HTML fetch)
- **Need structured data from one page (one record, e.g. a product page)** → Path B (AI `general`)
- **Need many rows from one listing/search page** → Path C (AI `listing`)
- **Need to discover URLs across a site (crawl)** → Path D (AI `map`)
- **Already have a `scraper_id` and want to apply it to new URL(s)** → Path E (`rerun`)
- **Need to read or poll stored results from earlier runs** → Path F (`results` / `result`)

The decision is mostly about *what kind of output* you need. If you
guess wrong, the response will tell you (empty results, wrong shape) —
switch paths and retry.

---

## Path A: Fetch Rendered HTML

Use this when you want the **raw rendered HTML** of a page — typically
because you'll parse it yourself (cheerio, BeautifulSoup, an LLM, etc.)
or just need to see what the page looks like to a real browser. This is
the cheapest and fastest mode.

This mode is **synchronous**: the HTTP response contains the HTML
directly. No polling.

```bash
mrscraper scrape "https://example.com/"
mrscraper scrape "https://example.com/" --geo-code US --timeout 120 --block-resources
```

Flags that apply in HTML mode:

| Flag | Default | What it does |
|------|---------|--------------|
| `--geo-code <code>` | `US` | ISO country for the render cluster (e.g. `GB`, `DE`, `ID`). |
| `--timeout <seconds>` | `120` | Max seconds the render is allowed to take. |
| `--block-resources` | off | Skip images/CSS/fonts. Faster, but breaks pages that need CSS to render content. |

**Trigger condition:** you call `scrape` and pass **none** of
`--prompt`, `--agent`, or `--proxy-country`. Adding any of those three
flips you into AI mode (Paths B / C / D).

---

## Path B: AI Scraper — `general`

Use this when the page has **one logical record** to extract — a
product page, an article, a profile, a job posting. You describe the
fields you want in a prompt, and MrScraper extracts them.

This mode is **asynchronous**. The `scrape` call returns metadata
(including a `scraper_id`) immediately; the actual extraction completes
in the background. Use `results` / `result` to poll for the final row
(see Path F).

```bash
mrscraper scrape "https://www.ebay.com/itm/266727555514" \
  --agent general \
  --prompt "get name, price, features/description, images, seller, and shipping"
```

If you omit `--prompt`, the default for `general` is:
`Get all data as complete as possible`.

If you pass only `--proxy-country` (no `--prompt`, no `--agent`), agent
defaults to `general` and prompt defaults to the line above.

| Flag | Default | What it does |
|------|---------|--------------|
| `-p`, `--prompt <text>` | `Get all data as complete as possible` | Tell the AI what to extract. Be specific — name the fields. |
| `--proxy-country <code>` | unset | Geographic proxy exit (e.g. `US`, `GB`, `ID`). Useful for geo-locked pages. |

**After the call:** grab `scraper_id` from the JSON response and either
poll for results (Path F) or use it to rerun on more URLs (Path E).

---

## Path C: AI Scraper — `listing`

Use this when the page has **many records of the same shape** — a
search result page, a product category, a job board listing. The
`listing` agent walks pagination for you.

Asynchronous, same polling pattern as Path B.

```bash
mrscraper scrape "https://books.toscrape.com/" \
  --agent listing \
  --prompt "Title, price, availability, product URL" \
  --max-pages 5
```

| Flag | Default | What it does |
|------|---------|--------------|
| `-p`, `--prompt <text>` | — | Required in practice — describe the per-row fields. |
| `--max-pages <n>` | `1` | How many paginated pages to follow. Default is intentionally tiny — bump it for real crawls. |
| `--proxy-country <code>` | unset | Geographic proxy exit. |

**Cost tip:** every page costs work. Start with `--max-pages 1` to
verify the prompt extracts the right fields, then bump it up.

---

## Path D: AI Scraper — `map`

Use this when you need to **discover URLs across a site** — e.g. "find
every product URL under `/shop/`", "list every doc page". `map` crawls
the site and returns a URL list, optionally filtered by regex.

Asynchronous.

```bash
mrscraper scrape "https://example.com/" \
  --agent map \
  --max-depth 2 \
  --max-pages 50 \
  --limit 1000 \
  --include-patterns "/products/" \
  --exclude-patterns "/products/archive/"
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--max-depth <n>` | `2` | How many link-hops from the seed URL. |
| `--max-pages <n>` | `50` | Cap on pages visited. |
| `--limit <n>` | `1000` | Cap on URLs returned. |
| `--include-patterns <regex>` | `""` | Only keep URLs matching this regex. |
| `--exclude-patterns <regex>` | `""` | Drop URLs matching this regex. |

`map` does **not** take `--prompt` — it returns URLs, not extracted
fields. Once you have the URL list, feed it into `rerun --bulk` (Path
E) with a `general` or `listing` scraper to extract content.

---

## Path E: Rerun A Saved Scraper

Use this when you already have a `scraper_id` (from a previous `scrape`
call) and want to apply that same configuration to **new URL(s)**.
Cheaper and more consistent than creating a fresh scraper each time.

Two flavors:

- `--type ai` — rerun an AI scraper (the ones from Paths B / C / D).
- `--type manual` — rerun a manual scraper (one a human built in the
  MrScraper UI). Same idea, different endpoint.

**Single URL:**

```bash
mrscraper rerun "https://example.com/page" \
  --type ai \
  --scraper-id SCRAPER_UUID
```

**Bulk (comma- or newline-separated URLs):**

```bash
mrscraper rerun "https://a.com/page1,https://a.com/page2,https://a.com/page3" \
  --bulk \
  --type ai \
  --id SCRAPER_UUID
```

| Flag | When required | What it does |
|------|---------------|--------------|
| `--type <ai\|manual>` | **always** | Which rerun endpoint to hit. |
| `--scraper-id <uuid>` | single-URL mode | The scraper to rerun. |
| `--bulk` | when target has commas/newlines | Switches to the bulk endpoint. |
| `--id <uuid>` | when `--bulk` is set | Same UUID as `--scraper-id`, separate flag so agents can keep a consistent name. |
| `--max-depth`, `--max-pages`, `--limit`, `--include-patterns`, `--exclude-patterns` | optional, AI only | Map-style fields, passed through on `--type ai` reruns only. Ignored for `--type manual`. |

**Sync vs async:** single-URL reruns return synchronously. **Bulk
reruns are asynchronous** — poll with `results` / `result`.

---

## Path F: Read / Poll Stored Results

Use this to:

- poll for a result row that an async `scrape` or `rerun` produced, or
- list all your stored results, or
- fetch one specific row by id.

Both commands are synchronous reads.

**List with filters and pagination:**

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search "example.com" --page 2
mrscraper results --date-range-column createdAt --start-at 2026-05-01 --end-at 2026-05-12
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--sort-field` | `updatedAt` | One of `createdAt`, `updatedAt`, `id`, `type`, `url`, `status`, `error`, `tokenUsage`, `runtime`. |
| `--sort-order` | `DESC` | `ASC` or `DESC`. |
| `--page-size` | `10` | Rows per page. |
| `--page` | `1` | 1-based page index. |
| `--search` | — | Free-text filter. |
| `--date-range-column` | — | Column to apply `--start-at` / `--end-at` against. |
| `--start-at`, `--end-at` | — | Inclusive ISO date range. |

**Fetch one row:**

```bash
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
```

**Polling pattern** (after an async `scrape` or bulk `rerun`):

1. Capture `scraper_id` (and, when present, a `result_id` / job id)
   from the create response.
2. Sleep a few seconds, then call `mrscraper results --search <url>`
   or `mrscraper result --id <result_id>`.
3. Read the row's `status` field. Keep polling until it reaches a
   terminal value (`success`, `failed`, etc.). Don't poll faster than
   ~3–5s — the work is genuinely async.

---

## Typical end-to-end flow

```bash
# 1. Auth once.
mrscraper login

# 2. Create an AI scraper on a representative URL.
mrscraper scrape "https://www.ebay.com/itm/266727555514" \
  --agent general \
  --prompt "get name, price, features/description, images, seller, and shipping"
# → JSON includes a scraper_id. Save it.

# 3. Reuse the same scraper on more URLs in bulk.
mrscraper rerun "https://www.ebay.com/itm/A,https://www.ebay.com/itm/B" \
  --bulk --type ai --id SCRAPER_UUID_FROM_STEP_2

# 4. Poll for the rows.
mrscraper results --search "ebay.com" --page-size 50
mrscraper result --id RESULT_UUID
```

## Global flags and conventions

- All output is JSON on stdout. Pipe into `jq` freely.
- All commands accept `--token <key>` to override the saved/env key for
  a single invocation.
- Help is available everywhere: `mrscraper --help`,
  `mrscraper <command> --help`.
- Non-zero exit code means the command failed. Inspect the `error`
  field of the JSON for the reason. A `401` status means the key is
  missing or wrong — re-run `mrscraper login` or fix the env var.

## When things go wrong

- **`Unauthorized or invalid token`** → the key is missing, expired, or
  wrong. Visit <https://app.mrscraper.com/api-tokens>, get a fresh
  key, re-run `mrscraper login` (or update the env var).
- **HTML mode timeout** → bump `--timeout`, try `--block-resources`,
  or try a different `--geo-code`.
- **AI scrape returned empty / wrong fields** → tighten the
  `--prompt`. Name the exact fields. Confirm the page actually has
  the data when rendered (Path A is a good sanity check).
- **`listing` returned only one page of rows** → default
  `--max-pages` is 1. Bump it.
- **Bulk rerun looks like nothing happened** → bulk is async. Poll
  with `results` / `result` instead of expecting data inline.
- **Geo-locked content** → set `--proxy-country` (AI) or `--geo-code`
  (HTML) to a country that can access the page.

## Programmatic use (Node.js)

If you'd rather skip the CLI and call the HTTP helpers directly from a
Node script, the same package exports them:

```js
import {
  VERSION,
  loadSavedApiKey,
  fetchHtmlApi,
  createAiScraperApi,
  rerunAiScraperApi,
  bulkRerunAiScraperApi,
  rerunManualScraperApi,
  bulkRerunManualScraperApi,
  getAllResultsApi,
  getResultByIdApi,
  parseBulkUrls,
} from "@mrscraper/cli";
```

The platform's REST API base is `https://api.app.mrscraper.com/api/v1`
(auth header `x-api-token: <key>`); the rendered-HTML endpoint is
`https://api.mrscraper.com` (token passed as a query param). The CLI is
a thin wrapper over these — nothing the CLI does is unavailable to a
raw HTTP client.

## References

- App + API key page: <https://app.mrscraper.com/api-tokens>
- npm package: <https://www.npmjs.com/package/@mrscraper/cli>
- Source: <https://github.com/mrscraper-com/cli>
- Docs: <https://docs.mrscraper.com>
