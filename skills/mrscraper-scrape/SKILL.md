---
name: mrscraper-scrape
description: |
  Extract structured data from a known URL with the MrScraper CLI's general or listing AI agent, or discover site URLs with its map agent. Use when the user requests specific fields, product or property details, repeated records, paginated listings, tables as JSON, or bounded site mapping. General and listing require an explicit prompt; map rejects prompts. Optional schema-prompt guidance is CLI-only and is not backend validation. Do not use merely to read a page; use mrscraper-fetch. Do not use for query-first discovery; use mrscraper-serp.
---

# Extract Structured Data with MrScraper

Use `scrape` when the result should contain requested fields or records. For
installation, authentication, or routing, use [mrscraper](../mrscraper/SKILL.md).

## Produce the Requested Artifact

For a detail page, use the default `general` agent with an explicit prompt:

```bash
mkdir -p ./.mrscraper
mrscraper scrape "<url>" \
  --prompt "Extract all available listing information. Preserve source values and do not infer missing fields." \
  --output ./.mrscraper/<site>-<page-slug>.json
```

`--output` is a CLI-only file operation. It writes the documented
`data.data.data` response value as pretty JSON without renaming, normalizing, or
decoding it. The full CLI response envelope remains on stdout. Treat a
successfully written file as the finished artifact.

Do not fetch first or manually reconstruct the returned JSON. Post-process only
when the user requests a different schema, filter, merge, normalization, CSV,
table, or another deliverable.

## Choose the API Agent

General and listing require `--prompt`; promptless use fails rather than routing
to fetch:

```bash
# One detail page or one general extraction task
mrscraper scrape "https://example.com/product" \
  --agent general --prompt "Extract the product details"

# Repeated records or pagination
mrscraper scrape "https://example.com/products" \
  --agent listing --prompt "Extract every product" --max-pages 5
```

Use map only for URL discovery. Map rejects `--prompt`, `--schema-prompt`, and
`--proxy-country` instead of silently dropping them:

```bash
mrscraper scrape "https://example.com" \
  --agent map --max-depth 2 --max-pages 50 --limit 1000
```

The CLI sends only map limits and patterns the caller supplies. Omitted values
remain omitted so the backend owns its defaults.

## Use Schema Text Honestly

When best-effort field guidance is useful, append a local JSON Schema to the
prompt:

```bash
mrscraper scrape "https://example.com/product" \
  --prompt "Extract the product details" \
  --schema-prompt ./product.schema.json \
  --output ./.mrscraper/product.json
```

`--schema-prompt` validates only that the local file contains a JSON object,
then appends it to the natural-language `message`. The API receives no `schema`
field and does not validate its output against that schema. Verify the returned
data yourself when strict downstream validation is required.

## Respect Parameter Boundaries

- `--agent` maps to API `agent` and visibly defaults to `general`.
- `--prompt` maps to API `message`; it is required for general/listing and
  rejected for map.
- `--proxy-country` maps to `proxyCountry` for general/listing only.
- `--max-pages` maps to `maxPages` for listing/map only.
- `--max-depth`, `--limit`, `--include-patterns`, and `--exclude-patterns` are
  map-only API fields.
- `--schema-prompt` and `--output` are explicitly CLI-only.
- Fetch browser parameters are not accepted by `scrape`.

## Treat Listing as Long-Running

Listing mode is synchronous and can take several minutes. Choose the smallest
practical `--max-pages`, tell the user before starting, allow a long execution
timeout, and keep waiting on the original process. The CLI writes progress to
stderr as `Listing still running...` without corrupting stdout JSON. Do not
respond to silence by submitting a duplicate request merely because no final
JSON has appeared yet.

## Handle Failures

- Check the exit code and confirm the requested output file exists.
- If no file is written, inspect the stdout envelope; do not create replacement
  data containing invented or null fields.
- Tighten the prompt when fields are missing or grouped incorrectly.
- Validate locally when strict schema compliance matters.
- Use fetch for page HTML and SERP when no target URL is known.

Keep `./.mrscraper/` out of version control unless the user asks to commit it.
