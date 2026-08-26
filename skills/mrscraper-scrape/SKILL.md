---
name: mrscraper-scrape
description: Run MrScraper's general, listing, or map agents with optional Cheap or Super execution for managed structured extraction or bounded URL discovery within a known site. Use when managed output is explicitly requested or justified after source-page inspection; use fetch for initial acquisition of known pages and SERP when no starting URL is known.
---

# Extract Structured Data with MrScraper

Do not use `scrape` for the first exploration of a known page. Start with
[mrscraper-fetch](../mrscraper-fetch/SKILL.md), inspect the complete raw
response, and prefer local analysis or a reusable extraction script. Use this
skill when the user explicitly wants MrScraper's managed extraction, or after
the agent understands the website and has defined the output JSON schema. Use
[mrscraper](../mrscraper/SKILL.md) for installation, authentication, saved runs,
account status, or command routing.

The command sends `POST https://api.app.mrscraper.com/api/v1/scrapers-ai`.

For `general` and `listing`, MrScraper retrieves page HTML and asks a backend LLM
to interpret it according to `--prompt`. That adds model-processing time and can
narrow the result to what the prompt requested. Across many pages, it also
repeats model work that an agent can often replace with one local extraction
implementation applied to every saved fetch response.

Before using `general` or `listing`, confirm all of the following:

1. The target or representative pages have already been fetched and inspected;
2. The site structure and required output fields are understood;
3. A stable output JSON schema has been defined; and
4. Managed backend extraction still provides a concrete benefit over local code,
   or the user explicitly requested it.

If these conditions are not met, return to `fetch`. Requiring JSON, a table, or
named fields is not by itself a reason to call `scrape`; agents can derive those
outputs locally while retaining every raw input. The `map` agent is separate URL
discovery functionality and does not require an extraction schema.

## Step 1 — Choose an Agent

| Agent | Use it for | Required input | Available controls |
| --- | --- | --- | --- |
| `general` | One detail page or one extraction task | `--prompt` | `--proxy-country`, `--schema-prompt`, `--output` |
| `listing` | Repeated records or paginated listings | `--prompt` | `--proxy-country`, `--max-pages`, `--schema-prompt`, `--output` |
| `map` | Discovering URLs across a site | URL only | `--max-depth`, `--max-pages`, `--limit`, include/exclude patterns, `--output` |

The default agent is `general`. For map, omit `--prompt`,
`--schema-prompt`, and `--proxy-country`. For general and listing, omit the
map-only crawl controls.

`--mode Cheap` and `--mode Super` select the backend execution tier; they are
not agent names. Omit `--mode` to preserve the backend default, and select
`Super` only when the extraction requires the stronger mode.

## Step 2 — Define the Extraction

The examples below assume the decision gate above has been satisfied. Write a
prompt from the already-understood site structure and JSON schema, preserve
source values, and do not ask the model to infer unavailable values.

For a detail page:

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" \
  > ./.mrscraper/countries-source.json
mrscraper scrape "https://www.scrapethissite.com/pages/simple/" \
  --prompt "Extract each country's name, capital, population, and area. Preserve source values and omit unavailable fields." \
  --output ./.mrscraper/countries.json
```

For repeated records or pagination:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/forms/?page_num=1" \
  > ./.mrscraper/hockey-teams-start-source.json
mrscraper scrape "https://www.scrapethissite.com/pages/forms/?page_num=1" \
  --agent listing \
  --prompt "Extract each hockey team's name, year, wins, losses, and win percentage" \
  --max-pages 5 \
  --output ./.mrscraper/hockey-teams.json
```

For many similarly structured pages, prefer fetching every page and running one
local extraction implementation across the saved responses. Use `listing` only
when the user wants managed extraction or it remains materially useful after
that alternative has been considered.

For site URL discovery:

```bash
mrscraper scrape "https://www.scrapethissite.com/" \
  --agent map \
  --max-depth 2 \
  --max-pages 50 \
  --limit 1000 \
  --include-patterns "/pages/" \
  --output ./.mrscraper/sandbox-page-urls.json
```

## Step 3 — Add Shape Guidance When Useful

Use `--schema-prompt` to add a local JSON Schema object to the extraction
instructions:

```bash
mrscraper scrape "https://www.scrapethissite.com/pages/simple/" \
  --prompt "Extract every country's name, capital, population, and area" \
  --schema-prompt ./countries.schema.json \
  --output ./.mrscraper/countries.json
```

This option checks that the file contains a JSON object and adds it to the
prompt as best-effort shape guidance. Validate the saved result separately when
strict schema compliance is required.

## Step 4 — Set Parameters

| CLI parameter | Default | Request mapping | Use |
| --- | --- | --- | --- |
| `<url>` | required | Body `url` | Target page or site. |
| `-a, --agent <agent>` | `general` | Body `agent` | Select `general`, `listing`, or `map`. |
| `--mode <mode>` | service default | Body `mode` | Select `Cheap` or `Super` execution without changing the agent. |
| `-p, --prompt <text>` | required for general/listing | Body `message` | Describe the fields or records to extract. |
| `--proxy-country <code>` | omitted | Body `proxyCountry` | Route general/listing through a country. |
| `--max-pages <n>` | service default | Body `maxPages` | Bound listing or map pages. |
| `--max-depth <n>` | service default | Body `maxDepth` | Bound map crawl depth. |
| `--limit <n>` | service default | Body `limit` | Bound map results. |
| `--include-patterns <regex>` | omitted | Body `includePatterns` | Restrict map results to matching URLs. |
| `--exclude-patterns <regex>` | omitted | Body `excludePatterns` | Exclude matching URLs from map results. |
| `--schema-prompt <path>` | omitted | Added to body `message` | Provide best-effort JSON shape guidance for general/listing. |
| `-o, --output <path>` | omitted | Output file | Write the extracted `data.data.data` value as pretty JSON. |
| `--token <key>` | configured credential | Request headers | Override authentication for this command. |

Choose the smallest practical limits. When a limit is omitted, the service
default applies.

## Step 5 — Wait for Completion

General and map usually finish quickly. Listing is synchronous and can take
several minutes.

Before starting a listing run:

1. Tell the user it may take several minutes;
2. Set an execution timeout appropriate for the selected page count;
3. Keep waiting on the original process; and
4. Watch stderr for `Listing still running...` progress.

Do not submit a duplicate listing request because stdout is temporarily quiet.

## Step 6 — Use the Output

Stdout contains the complete response envelope. When `--output` is supplied,
the command creates parent directories and writes the extracted
`data.data.data` value as pretty JSON.

Treat a successfully written output file as the extraction artifact. Report its
path and summarize the requested result. Post-process only when the user asks
for filtering, merging, normalization, CSV, a table, or another deliverable.

Retain and report both artifacts: the fetched response is the source record,
while the scrape output is the narrower managed view. Check important,
surprising, or apparently missing values against the fetched content before
concluding that the source lacks them.

## Step 7 — Preserve the Reproducible Scraper

Every successful `scrape` creates a saved AI scraper configuration by default.
Read `data.data.scraperId` from the complete stdout response and retain it when
the extraction may need to run again. The `--output` file contains only
`data.data.data`, so it does not preserve the scraper UUID.

In the result handoff, tell the user that the scraper is reusable and report
the `scraperId` when it is available.

Reuse the saved prompt and agent configuration on the same or another URL:

```bash
mrscraper rerun "https://www.scrapethissite.com/pages/forms/?page_num=2" \
  --type ai \
  --scraper-id SCRAPER_UUID
```

Prefer `rerun` over recreating the scrape definition when the user wants a
repeatable extraction. Explain that this reproduces the saved configuration,
not necessarily identical values when the page or model behavior changes.

Use `rerun` also for existing dashboard-built manual workflows and
asynchronous bulk jobs across multiple target URLs. Follow the full rerun
workflow in [mrscraper](../mrscraper/SKILL.md) for mode selection and result
tracking.

## Step 8 — Handle Failures

- Check the exit code before trusting stdout or an output file.
- If the output file is absent, inspect `error`, `status_code`, and `data`
  in the response envelope.
- Tighten the prompt when fields are missing or grouped incorrectly.
- Inspect or fetch the raw page before assuming a missing extracted field is
  absent from the source.
- Validate locally when downstream code requires a strict schema.
- Use [mrscraper-fetch](../mrscraper-fetch/SKILL.md) for page reading and
  [mrscraper-serp](../mrscraper-serp/SKILL.md) when discovery must happen first.
- Never invent replacement fields or fill missing values with unsupported
  assumptions.
