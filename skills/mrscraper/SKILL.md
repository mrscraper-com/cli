---
name: mrscraper
description: |
  MrScraper CLI onboarding and routing guide. Use when an agent needs to install, authenticate, configure, or troubleshoot MrScraper; choose between its web-data commands; work with saved scraper reruns or stored results; check account usage; or handle a request that spans multiple MrScraper capabilities. Route known-URL page reading to mrscraper-fetch, structured field extraction to mrscraper-scrape, and query-first Google discovery to mrscraper-serp. Do not invent browser interaction, local-file parsing, monitoring, scheduling, or manual-scraper creation commands; this CLI does not provide them.
---

# MrScraper

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
  later;
- installs the four-skill MrScraper pack into supported agent harnesses already
  present on the machine; and
- registers `@mrscraper/mcp` as a local stdio MCP server in those harnesses.

Always include `--yes` when an agent launches `init` to keep bootstrap
non-interactive. The `-y` in `npx -y` approves package execution only; it does
not authenticate the CLI. Without `--yes`, an interactive human is asked for
an API key; agents must not use that interactive path. `--all` means all
detected harnesses. It does not add agents that are not installed. Use
`--agent codex --yes` or another value shown by `mrscraper init --help` to
target one harness.

Refresh the complete skill pack without reinstalling the CLI or authenticating:

```bash
mrscraper setup skills
mrscraper setup skills --agent codex
mrscraper setup mcp
mrscraper setup mcp --agent codex
```

After bootstrap, run `mrscraper auth status --json`. If it reports
`authenticated: false`, let bootstrap remain finished. In a local interactive
session, run `mrscraper login` and tell the human to approve the browser request.
Keep the command running until approval completes; do not submit a duplicate.
In a headless, remote, or unattended session, do not launch browser login—ask
the human to run it locally or configure `MRSCRAPER_API_KEY`. Never ask them to
paste a key into chat or wait for secret input. The bootstrap does not start
OAuth, add project templates, or select a default web provider. The installed
MCP becomes available after the client reloads or starts a new session; use the
CLI in the current session when the MCP tools are not yet visible.

## Authenticate

MrScraper supports browser OAuth for interactive humans and API keys for CI or
other non-interactive environments.

- For local interactive use, the agent may run `mrscraper login`; the human
  approves in the opened browser and the CLI stores the resulting OAuth session.
- Keep the login process alive while the human approves. It times out after five
  minutes. If the browser cannot run on the same machine as the CLI, stop and
  use an API key instead.
- For CI or containers, set `MRSCRAPER_API_KEY`.
- To store an API key explicitly, the human can run
  `mrscraper login --api-key <key>` outside the agent conversation.

```bash
mrscraper login
mrscraper auth status --json
mrscraper status
```

OAuth and API-key credentials share `~/.mrscraper/auth.json`; treat it like a
password. The CLI and local stdio MCP server both use this file. Do not read or
print it. Do not ask the human to paste an API key into chat. Prefer a saved
credential or environment variable over `--token`, which can expose a key in
shell history.

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

## Run Core Web Commands

Use the command that matches the requested outcome. Save artifacts under
`./.mrscraper/` in the user's current project, never under `~/.mrscraper/`:

```bash
# Read page content
mkdir -p ./.mrscraper
mrscraper fetch "https://example.com/page" > ./.mrscraper/page.json

# Extract structured data, such as a product, property, or job listing
mrscraper scrape "https://example.com/listing" \
  --prompt "Extract all available listing information" \
  --output ./.mrscraper/listing.json

# Search Google when no target URL is known
mrscraper serp "example search query" > ./.mrscraper/search.json
```

`fetch` and `serp` write JSON envelopes to stdout. `scrape --output` writes only
the extracted payload. Check the exit code, then report the useful result and
artifact path. Load the focused skill for detailed options and edge cases.

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

Use `status --json` without a domain for subscription and quota information.
Add a domain and time range for stored MrScraper request outcomes:

```bash
mrscraper status --json
mrscraper status --json --domain example.com --from 7d
mrscraper status --json --domain example.com \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-10T00:00:00Z
```

Domain analytics are scrape request outcomes. They are not SEO, traffic,
audience, or market analytics. Interactive humans can omit `--json` to see the
account dashboard; agents should request JSON explicitly.

## Run Without a Global Install

Use the npm package directly for one-off commands:

```bash
npx -y @mrscraper/cli@latest status --json
npx -y @mrscraper/cli@latest results --page-size 10
```

Authentication requirements remain the same. Running `init` is not ephemeral;
it intentionally installs the CLI and skills globally and registers MCP.

## Handle Shared Output Safely

- Expect JSON on stdout for data commands. Pass `status --json` explicitly
  because an interactive terminal otherwise renders its human dashboard.
  Progress and warnings go to stderr.
- Check the process exit code. API failures exit nonzero and include `error`,
  `status_code`, and response `data` when available.
- Save large web responses under the current project's `.mrscraper/`, inspect
  their size, and read them incrementally with `jq`, `head`, or targeted
  searches. This project folder is unrelated to `~/.mrscraper/auth.json`.
- Quote URLs because `?` and `&` have shell meaning.
- Keep `.mrscraper/` out of version control unless the user explicitly wants
  its artifacts committed.
- Never print credentials, commit credential files, or publish account output.

## Troubleshoot Shared Failures

- **Unauthorized or 401** — ask the human to run `mrscraper login` again, or
  verify the automation's `MRSCRAPER_API_KEY` without exposing it.
- **Skill pack missing after bootstrap** — run
  `mrscraper setup skills --dry-run`, then pass `--agent <name>` if harness
  detection uses a nonstandard home directory.
- **MCP tools missing after bootstrap** — run
  `mrscraper setup mcp --agent <name> --dry-run`, apply it without `--dry-run`,
  then restart the MCP client or open a new session.
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
- an unauthenticated API tier.

If the task requires one of these capabilities, explain the limitation.
