---
name: mrscraper
description: |
  MrScraper gives AI agents live web context through page fetching with automatic unblocking, prompt- or schema-based extraction, Google SERPs, saved scraper reruns, stored results, and account analytics. Use this onboarding guide when an agent needs to install or authenticate the MrScraper CLI, choose the correct command, recover from a failed web request, or route a user's web-data task. Do not invent browser interaction, local-file parsing, monitoring, scheduling, or manual-scraper creation commands; those are not provided by this CLI.
---

# MrScraper

MrScraper helps agents fetch readable page content, extract structured data,
discover pages through Google, reuse saved scrapers, and inspect results and
account usage. One bootstrap command installs the CLI, configures credentials,
and adds this skill to agent harnesses already present on the machine.

## Bootstrap MrScraper

Run the bootstrap from any directory:

```bash
npx -y @mrscraper/cli@latest init --all
```

It performs three focused actions:

- installs the same `@mrscraper/cli` version globally;
- reuses existing credentials or asks the human to enter an API key; and
- detects supported agent harnesses and installs the `mrscraper` skill into
  those harnesses through the public `skills` installer.

`--all` means all **detected** harnesses; it does not add configuration for
agents that are not installed. Use `--agent codex` (or another value shown by
`mrscraper init --help`) to choose one explicitly. To refresh skills later
without reinstalling or authenticating the CLI, run:

```bash
mrscraper setup skills
mrscraper setup skills --agent codex
```

For unattended setup, `--yes` prevents an API-key prompt. If no credential is
already configured, run `mrscraper login` before making web requests.

The bootstrap does not configure MCP servers, project templates, browser OAuth,
or a default web provider. Those are not MrScraper CLI features.

This gives the agent:

- **Page fetching** — `mrscraper fetch` returns Markdown, HTML, or a page
  document and can escalate automatically to browser rendering.
- **Structured extraction** — `mrscraper scrape` extracts requested fields
  using a prompt or JSON Schema.
- **Google discovery** — `mrscraper serp` returns parsed Google results or raw
  result-page HTML.
- **Saved work** — `mrscraper rerun`, `mrscraper results`, and
  `mrscraper result` reuse and inspect existing jobs.
- **Account visibility** — `mrscraper status` reports quota and optional domain
  scrape analytics.

Before doing substantial work, verify the installation and authentication with
one small real request:

```bash
mrscraper status
mkdir -p .mrscraper
mrscraper fetch "https://books.toscrape.com/" > .mrscraper/install-check.json
jq -r '.data' .mrscraper/install-check.json | head -40
```

Keep `.mrscraper/` out of version control unless the user explicitly wants the
artifacts committed.

## Authenticate

MrScraper requires an API key. It does not currently provide browser OAuth or a
keyless CLI tier.

Users can authenticate in two ways:

- **Saved CLI credential (default)** — ask the human to create or copy an API
  key at <https://app.mrscraper.com/api-tokens>, then let them enter it directly
  into the bootstrap or `mrscraper login`.
- **Environment variable** — set `MRSCRAPER_API_KEY` for CI, containers, or
  other unattended environments.

```bash
mrscraper login
```

Do not ask the human to paste the key into chat. Prefer a saved credential or
environment variable over `--token`, which can expose a key in shell history.

## Choose the Right Command

- **Have a URL and need its readable content** → use `fetch`
- **Have a URL and need specific structured fields** → use `scrape`
- **Need to discover relevant pages first** → use `serp`
- **Need to rerun or inspect saved work** → use `rerun`, `results`, or `result`
- **Need quota or scrape-outcome analytics** → use `status`
- **Do not want a global CLI installation** → run the package with `npx`
- **Need to restore or update the agent skill** → use `setup skills`
- **Need clicks, login, local-file parsing, monitoring, manual creation, or
  scheduling** → see Know the Limits

The default live-web flow is:

1. Start with `serp` only when no target URL is known.
2. Use `fetch` when the agent needs content to read, summarize, cite, or reason
   over.
3. Use `scrape` directly when the user needs defined fields or a JSON-shaped
   result.
4. Preserve returned IDs and use `results` or `result` for follow-up.
5. If a page blocks `fetch`, escalate its unblocker controls instead of
   switching to an invented interaction command.

---

## Fetch Page Content

Use this when the agent has a URL and needs the page content without an
extraction prompt.

```bash
mrscraper fetch "https://example.com" > .mrscraper/example.json
mrscraper fetch "https://example.com" --format html > .mrscraper/example-html.json
mrscraper fetch "https://example.com" --format json > .mrscraper/example-document.json
```

Markdown is the default. The CLI writes a JSON envelope to stdout, and the
formatted page is in `.data`:

```bash
mrscraper fetch "https://example.com" | jq -r '.data'
```

Escalate the unblocker progressively:

```bash
# Start direct and escalate automatically when a likely block is detected
mrscraper fetch "https://example.com" --unblock auto

# Force browser rendering
mrscraper fetch "https://example.com" --unblock always

# Wait for a CSS selector on a dynamic page
mrscraper fetch "https://example.com/products" \
  --unblock always --wait-for ".product-card"

# Add geo routing or homepage navigation when the site requires it
mrscraper fetch "https://example.com" \
  --unblock always --geo ID --homepage --retries 3
```

Treat `--wait-for` as a CSS selector, not a number of milliseconds. Use
`--block-resources` when non-essential assets slow rendering and
`--timeout <seconds>` for slow pages. Keep retries bounded.

---

## Extract Structured Data

Use this when the user requests particular fields or an explicit output
contract. Always provide `--prompt` or `--schema`; promptless `scrape` is only a
deprecated HTML-fetch compatibility alias.

```bash
mrscraper scrape "https://books.toscrape.com/" \
  --prompt "Extract every book's title, price, and availability"

mrscraper scrape "https://example.com/product" \
  --prompt "Extract the product" \
  --schema ./product.schema.json
```

Use the existing extraction modes only when needed:

```bash
mrscraper scrape "https://example.com/product" \
  --agent general --prompt "Extract the product details"

mrscraper scrape "https://example.com/products" \
  --agent listing --prompt "Extract every product" --max-pages 5

mrscraper scrape "https://example.com" \
  --agent map --max-depth 2 --max-pages 50 --limit 1000
```

Map mode does not accept `--schema`. AI scrape accepts
`--proxy-country <code>`, but not fetch-only controls such as `--unblock`,
`--wait-for`, `--homepage`, retry caps, or token caps.

---

## Find Pages with Google

Use `serp` when the task begins with a query rather than a known URL. Select
only results relevant to the goal, then fetch page content or extract
structured data from the chosen URLs.

```bash
mrscraper serp "web scraping best practices" > .mrscraper/search.json
mrscraper serp "running shoes" --region id --language id --page 2
mrscraper serp "https://www.google.com/search?q=web+scraping&gl=us&hl=en"
```

JSON is the default. Use `--format html` only when raw Google HTML is required,
and use `--render-js` only for JavaScript-rendered SERP features. Do not fetch
every result by default.

---

## Rerun and Inspect Saved Work

Rerun an existing scraper instead of recreating its extraction logic:

```bash
mrscraper rerun "https://example.com/product" \
  --type ai --scraper-id SCRAPER_UUID

mrscraper rerun "https://example.com/product" \
  --type manual --scraper-id SCRAPER_UUID

mrscraper rerun "https://a.example,https://b.example" \
  --bulk --type manual --id SCRAPER_UUID
```

Single reruns require `--scraper-id`; bulk reruns require `--bulk` and `--id`.

Find or retrieve stored results:

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search example.com --page 2
mrscraper result RESULT_UUID
```

This CLI can rerun an existing manual scraper, but cannot create or schedule
one.

---

## Review Usage and Domain Outcomes

Use `status` without a domain for subscription and quota information. Add a
domain and time range for stored scrape-outcome analytics.

```bash
mrscraper status
mrscraper status --domain example.com --from 7d
mrscraper status --domain example.com \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-10T00:00:00Z
```

Domain analytics describe MrScraper request outcomes for the selected domain.
They are not SEO, traffic, audience, or market analytics.

---

## Run Without a Global Install

Use the npm package directly for an ephemeral or one-off session:

```bash
npx -y @mrscraper/cli@latest status
npx -y @mrscraper/cli@latest fetch "https://example.com"
npx -y @mrscraper/cli@latest scrape "https://example.com/product" \
  --prompt "Extract the product name and price"
```

Authentication requirements are unchanged: use `MRSCRAPER_API_KEY`, an
existing saved credential, or run `mrscraper login`. Running `init` is not an
ephemeral action: the bootstrap intentionally installs the CLI and skill
globally. There is no keyless fallback.

## Handle JSON Output

- Expect JSON on stdout for every data command. Progress and warnings go to
  stderr.
- Check the process exit code. API failures exit nonzero and include `error`,
  `status_code`, and response `data` when available.
- Save large responses under `.mrscraper/`, inspect their size first, and read
  them incrementally with `jq`, `head`, or targeted searches.
- Quote every URL because `?` and `&` have shell meaning.
- Do not print credentials, commit credential files, or publish account output.

## Troubleshoot

- **Unauthorized or 401** — run `mrscraper login` again or verify
  `MRSCRAPER_API_KEY`.
- **Skill missing after bootstrap** — run `mrscraper setup skills --dry-run` to
  inspect detection, then use `--agent <name>` when the harness uses a
  nonstandard home directory.
- **Challenge page, 403, 429, or incomplete HTML** — retry `fetch` with
  `--unblock always`; add `--geo`, `--homepage`, or `--wait-for` only when the
  target requires it.
- **Dynamic content missing** — use `fetch --unblock always --wait-for
  "<selector>"`.
- **Slow page** — increase `fetch --timeout` moderately.
- **Incorrect extraction** — make the `scrape --prompt` explicit and add a JSON
  Schema when the output contract matters.
- **Need a prior run** — use `results` to locate its UUID, then `result`.
- **Unknown option or behavior** — run `mrscraper <command> --help` rather than
  guessing.

## Know the Limits

Do not invent unsupported commands or claim that an extraction mode is an
interactive browser agent.

The current CLI does not provide:

- clicks, form entry, or authenticated browser-session interaction;
- local PDF, DOCX, spreadsheet, or other file parsing;
- recurring monitoring or notifications;
- manual scraper creation or scheduling; or
- a keyless API tier.

If the task requires one of these, stop and explain the limitation. A manual
scraper created elsewhere in MrScraper can still be run with `rerun`.

Scrape only content the user is authorized to access. Respect applicable site
terms, privacy rules, copyright, and computer-access laws.
