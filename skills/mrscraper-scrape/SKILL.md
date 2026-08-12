---
name: mrscraper-scrape
description: |
  Extract structured data from a known URL with the MrScraper CLI using a natural-language prompt, JSON Schema, and the general, listing, or map AI modes. Use when the user asks to get listing information or details from a URL, requests specific fields, product or property listings, repeated records, tables as JSON, or an explicit output contract. Do not use merely to read, summarize, or archive a page; use mrscraper-fetch. Do not use to discover pages from a general web query; use mrscraper-serp.
---

# Extract Structured Data with MrScraper

Use `scrape` when the result should contain requested fields or records rather
than the full readable page. For installation, authentication, or cross-command
routing, use [mrscraper](../mrscraper/SKILL.md).

## Produce the Final Artifact Directly

For a request such as "Get the listing information from this URL," run one
prompt-based scrape and save its extracted payload with `--output`:

```bash
mrscraper scrape "<url>" \
  --prompt "Extract all available listing information. Preserve source values and do not infer missing fields." \
  --output .mrscraper/<site>-<page-slug>.json
```

The CLI creates parent directories and writes only the extracted object or
array to the output file. It excludes the API envelope, IDs, headers, runtime,
HTML, Markdown, and screenshots. It also decodes one JSON-encoded payload when
necessary. The full response envelope remains on stdout for diagnostics.

Treat a successfully written file as the finished artifact. Do not fetch the
page first, manually rewrite the returned JSON, or run another extraction just
to rename, normalize, enrich, or summarize fields. Post-process only when the
user requests a different schema, filter, merge, CSV or table conversion,
normalization, or another deliverable. In the final response, report the file
path and a concise result summary; do not reproduce the entire file unless the
user asks.

Do not confuse a domain noun with an agent mode. A single property, product,
vehicle, or job listing detail page uses the default `general` agent. Use the
`listing` agent only for a page with repeated records or required pagination.

## Define the Extraction

Always provide `--prompt`, `--schema`, or both. Promptless `scrape` is only a
deprecated HTML-fetch compatibility alias; use `mrscraper fetch` for page
content.

Start with a concrete prompt:

```bash
mrscraper scrape "https://books.toscrape.com/" \
  --prompt "Extract every book's title, price, and availability" \
  --output .mrscraper/books.json
```

Add a JSON Schema when field names and types must be stable:

```bash
mrscraper scrape "https://example.com/product" \
  --prompt "Extract the product details" \
  --schema ./product.schema.json \
  --output .mrscraper/product.json
```

Write prompts that identify:

- the records to collect;
- the exact fields required;
- relevant inclusion or exclusion rules; and
- whether all visible records or only one record is expected.

Do not ask for fields the page cannot reasonably support. Add a schema only
when the user or a stated downstream consumer requires predictable field names
and types; saving JSON by itself does not require a schema.

## Choose an AI Mode

Use the narrowest mode that matches the site:

```bash
# One page or a general extraction task
mrscraper scrape "https://example.com/product" \
  --agent general --prompt "Extract the product details"

# Repeated records across listing pagination
mrscraper scrape "https://example.com/products" \
  --agent listing --prompt "Extract every product" --max-pages 5

# Discover URLs within one site
mrscraper scrape "https://example.com" \
  --agent map --max-depth 2 --max-pages 50 --limit 1000
```

- `general` handles a normal structured extraction.
- `listing` handles repeated records and bounded pagination.
- `map` discovers URLs within a known site; it does not accept `--schema`.

Keep `--max-pages`, `--max-depth`, and `--limit` proportional to the user's
request. Use include or exclude URL patterns only when the requested site scope
is clear.

### Treat Listing as a Long-Running Operation

`--agent listing` is synchronous and can take several minutes before it prints
JSON. In current testing, even a one-page listing took about 150 seconds; the
actual time varies with the target and service load.

Before starting listing mode:

- use `general` when every requested record is already visible on one page and
  pagination is unnecessary;
- tell the user that the listing request may take 2–3 minutes or longer;
- choose the smallest practical `--max-pages` value;
- allow at least a 10-minute execution timeout when the agent harness permits
  it; and
- keep waiting on the original process instead of submitting a duplicate
  request when no JSON has appeared yet.

The CLI writes `Listing still running...` heartbeats to stderr every 30 seconds
for non-interactive sessions. Treat those messages as progress and continue
waiting for the final JSON on stdout.

## Respect API Boundaries

The AI scrape API accepts `--proxy-country <code>`. It does not accept
fetch-only browser controls such as unblock policies, selector waits, homepage
navigation, resource blocking, retry caps, or token caps.

If the task only needs rendered page content, switch to
[mrscraper-fetch](../mrscraper-fetch/SKILL.md). Do not pretend that fetched
content can be piped back into `scrape`; this CLI accepts a URL for extraction.

## Handle Results and Failures

- Use `--output` for the final JSON artifact and check the command exit code.
- If no artifact is written, inspect the stdout envelope and reported error;
  do not create a replacement containing `null`, metadata, or invented fields.
- If fields are missing or incorrectly grouped, make the prompt more explicit.
- If names or types drift, add or tighten the JSON Schema.
- If a listing is incomplete, verify that `listing` mode and a sufficient but
  bounded `--max-pages` value are used.
- If site mapping is too broad, constrain its depth, result limit, or URL
  patterns.
- If authentication fails, use the `mrscraper` router skill.
- If the request begins with an unknown target, use
  [mrscraper-serp](../mrscraper-serp/SKILL.md) first.

Do not claim this command creates or schedules manual scrapers, or operates an
interactive browser. Access only data the user is authorized to extract.
