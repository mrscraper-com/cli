---
name: mrscraper-scrape
description: Extract structured data from a known URL with the MrScraper CLI using the general, listing, or map agent. Use for requested fields, product or property details, repeated records, paginated listings, tables as JSON, or bounded site URL discovery. General handles one-page extraction, listing handles repeated or paginated records, and map discovers URLs. JSON Schema files can provide best-effort output-shape guidance. Use mrscraper-fetch to read page content and mrscraper-serp when no target URL is known.
---

# Extract Structured Data with MrScraper

Use `scrape` when the user wants defined fields, records, or site URLs from a
known page or website. Use [mrscraper](../mrscraper/SKILL.md) for installation,
authentication, saved runs, account status, or command routing.

The command sends `POST https://api.app.mrscraper.com/api/v1/scrapers-ai`.

## Step 1 — Choose an Agent

| Agent | Use it for | Required input | Available controls |
| --- | --- | --- | --- |
| `general` | One detail page or one extraction task | `--prompt` | `--proxy-country`, `--schema-prompt`, `--output` |
| `listing` | Repeated records or paginated listings | `--prompt` | `--proxy-country`, `--max-pages`, `--schema-prompt`, `--output` |
| `map` | Discovering URLs across a site | URL only | `--max-depth`, `--max-pages`, `--limit`, include/exclude patterns, `--output` |

The default agent is `general`. For map, omit `--prompt`,
`--schema-prompt`, and `--proxy-country`. For general and listing, omit the
map-only crawl controls.

## Step 2 — Define the Extraction

Write a prompt that names the fields or records the user needs and preserves
source values. Do not ask the model to infer unavailable values.

For a detail page:

```bash
mkdir -p ./.mrscraper
mrscraper scrape "https://example.com/product" \
  --prompt "Extract name, price, availability, description, and image URLs. Preserve source values and omit unavailable fields." \
  --output ./.mrscraper/example-product.json
```

For repeated records or pagination:

```bash
mrscraper scrape "https://example.com/products" \
  --agent listing \
  --prompt "Extract every product's name, price, availability, and URL" \
  --max-pages 5 \
  --output ./.mrscraper/example-products.json
```

For site URL discovery:

```bash
mrscraper scrape "https://example.com" \
  --agent map \
  --max-depth 2 \
  --max-pages 50 \
  --limit 1000 \
  --include-patterns "/products/" \
  --output ./.mrscraper/example-product-urls.json
```

## Step 3 — Add Shape Guidance When Useful

Use `--schema-prompt` to add a local JSON Schema object to the extraction
instructions:

```bash
mrscraper scrape "https://example.com/product" \
  --prompt "Extract the product details" \
  --schema-prompt ./product.schema.json \
  --output ./.mrscraper/product.json
```

This option checks that the file contains a JSON object and adds it to the
prompt as best-effort shape guidance. Validate the saved result separately when
strict schema compliance is required.

## Step 4 — Set Parameters

| CLI parameter | Default | Request mapping | Use |
| --- | --- | --- | --- |
| `<url>` | required | Body `url` | Target page or site. |
| `-a, --agent <agent>` | `general` | Body `agent` | Select `general`, `listing`, or `map`. |
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

## Step 7 — Preserve the Reproducible Scraper

Every successful `scrape` creates a saved AI scraper configuration by default.
Read `data.data.scraperId` from the complete stdout response and retain it when
the extraction may need to run again. The `--output` file contains only
`data.data.data`, so it does not preserve the scraper UUID.

In the result handoff, tell the user that the scraper is reusable and report
the `scraperId` when it is available.

Reuse the saved prompt and agent configuration on the same or another URL:

```bash
mrscraper rerun "https://example.com/another-product" \
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
- Validate locally when downstream code requires a strict schema.
- Use [mrscraper-fetch](../mrscraper-fetch/SKILL.md) for page reading and
  [mrscraper-serp](../mrscraper-serp/SKILL.md) when discovery must happen first.
- Never invent replacement fields or fill missing values with unsupported
  assumptions.
