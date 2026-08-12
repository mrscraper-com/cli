---
name: mrscraper
description: |
  MrScraper CLI onboarding and routing guide. Use when an agent needs to install, authenticate, configure, or troubleshoot MrScraper; choose between its web-data commands; work with saved scraper reruns or stored results; check account usage; or handle a request that spans multiple MrScraper capabilities. Route known-URL page reading to mrscraper-fetch, structured field extraction to mrscraper-scrape, and query-first Google discovery to mrscraper-serp. Do not invent browser interaction, local-file parsing, monitoring, scheduling, or manual-scraper creation commands; this CLI does not provide them.
---

# MrScraper Router

Use this skill for setup, command selection, shared operating rules, and the
commands that do not have a focused skill. Load the focused skill whenever the
request clearly belongs to fetch, scrape, or SERP.

## Bootstrap MrScraper

Run the bootstrap non-interactively from any directory:

```bash
npx -y @mrscraper/cli@latest init --all --yes
```

The bootstrap:

- installs the same published `@mrscraper/cli` version globally;
- reuses saved credentials or leaves authentication for the human to configure
  later; and
- installs the four-skill MrScraper pack into supported agent harnesses already
  present on the machine.

Always include `--yes` when an agent launches `init`. It prevents the CLI from
waiting for an API-key response. The `-y` in `npx -y` or `pnpm dlx -y` approves
package execution only; it does not answer CLI prompts. `--all` means all
detected harnesses. It does not add agents that are not installed. Use
`--agent codex --yes` or another value shown by `mrscraper init --help` to
target one harness.

Refresh the complete skill pack without reinstalling the CLI or authenticating:

```bash
mrscraper setup skills
mrscraper setup skills --agent codex
```

When no key is already configured, let bootstrap finish and ask the human to
set `MRSCRAPER_API_KEY` or run `mrscraper login` themselves in an interactive
terminal. Do not run an interactive login on their behalf, ask them to paste a
key into chat, or wait for secret input. The bootstrap does not configure MCP,
project templates, browser OAuth, or a default web provider.

## Authenticate

MrScraper requires an API key and has no browser OAuth or keyless CLI tier.

- For interactive use, create or copy a key at
  <https://app.mrscraper.com/api-tokens>, then enter it directly into
  `mrscraper login` or the bootstrap prompt.
- For CI or containers, set `MRSCRAPER_API_KEY`.

```bash
mrscraper login
mrscraper status
```

Do not ask the human to paste an API key into chat. Prefer a saved credential or
environment variable over `--token`, which can expose a key in shell history.

## Route the Request

- **Known URL; need readable page content, HTML, or a page document** → load
  [mrscraper-fetch](../mrscraper-fetch/SKILL.md).
- **Known URL; need defined fields, records, listings, or structured JSON** →
  load [mrscraper-scrape](../mrscraper-scrape/SKILL.md).
- **No target URL; need to find pages through Google** → load
  [mrscraper-serp](../mrscraper-serp/SKILL.md).
- **Need to rerun a saved AI/manual scraper or inspect stored results** → use
  `rerun`, `results`, or `result` below.
- **Need subscription quota or MrScraper request outcomes for a domain** → use
  `status` below.

When “scrape this page” is ambiguous, decide from the requested output:

- content to read, summarize, cite, or archive means `fetch`;
- selected fields, repeated records, or a JSON contract means `scrape`.

For discovery-first work, run SERP, select only relevant URLs, and then load
either fetch or scrape for the chosen pages.

## Rerun and Inspect Saved Work

Reuse an existing scraper instead of recreating its extraction logic:

```bash
mrscraper rerun "https://example.com/product" \
  --type ai --scraper-id SCRAPER_UUID

mrscraper rerun "https://example.com/product" \
  --type manual --scraper-id SCRAPER_UUID

mrscraper rerun "https://a.example,https://b.example" \
  --bulk --type manual --id SCRAPER_UUID
```

Single reruns require `--scraper-id`. Bulk reruns require `--bulk` and `--id`.

Find or retrieve stored results:

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search example.com --page 2
mrscraper result RESULT_UUID
```

The CLI can run a manual scraper created elsewhere in MrScraper, but cannot
create or schedule one.

## Review Usage and Domain Outcomes

Use `status` without a domain for subscription and quota information. Add a
domain and time range for stored MrScraper request outcomes:

```bash
mrscraper status
mrscraper status --domain example.com --from 7d
mrscraper status --domain example.com \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-10T00:00:00Z
```

Domain analytics are scrape request outcomes. They are not SEO, traffic,
audience, or market analytics.

## Run Without a Global Install

Use the npm package directly for one-off commands:

```bash
npx -y @mrscraper/cli@latest status
npx -y @mrscraper/cli@latest results --page-size 10
```

Authentication requirements remain the same. Running `init` is not ephemeral;
it intentionally installs the CLI and skills globally.

## Handle Shared Output Safely

- Expect JSON on stdout for data commands. Progress and warnings go to stderr.
- Check the process exit code. API failures exit nonzero and include `error`,
  `status_code`, and response `data` when available.
- Save large web responses under `.mrscraper/`, inspect their size, and read
  them incrementally with `jq`, `head`, or targeted searches.
- Quote URLs because `?` and `&` have shell meaning.
- Keep `.mrscraper/` out of version control unless the user explicitly wants
  its artifacts committed.
- Never print credentials, commit credential files, or publish account output.

## Troubleshoot Shared Failures

- **Unauthorized or 401** — run `mrscraper login` again or verify
  `MRSCRAPER_API_KEY`.
- **Skill pack missing after bootstrap** — run
  `mrscraper setup skills --dry-run`, then pass `--agent <name>` if harness
  detection uses a nonstandard home directory.
- **Page blocked or incomplete** — load `mrscraper-fetch` for its unblock
  escalation procedure.
- **Extraction is incorrect** — load `mrscraper-scrape` and tighten the prompt
  or schema.
- **Search results are wrong or incomplete** — load `mrscraper-serp` and review
  its query and locale guidance.
- **Unknown option** — run `mrscraper <command> --help` instead of guessing.

## Know the Limits

Do not claim that an extraction mode is an interactive browser agent. The CLI
does not provide:

- clicks, form entry, or authenticated browser-session interaction;
- local PDF, DOCX, spreadsheet, or other file parsing;
- recurring monitoring or notifications;
- manual scraper creation or scheduling; or
- a keyless API tier.

If the task requires one of these capabilities, explain the limitation. Scrape
only content the user is authorized to access, and respect applicable site
terms, privacy rules, copyright, and computer-access laws.
