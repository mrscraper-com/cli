---
name: mrscraper-scrape
description: |
  Extract structured data from a known URL with the MrScraper CLI using a natural-language prompt, JSON Schema, and the general, listing, or map AI modes. Use when the user requests specific fields, product or property listings, repeated records, tables as JSON, or an explicit output contract. Do not use merely to read, summarize, or archive a page; use mrscraper-fetch. Do not use to discover pages from a general web query; use mrscraper-serp.
---

# Extract Structured Data with MrScraper

Use `scrape` when the result should contain requested fields or records rather
than the full readable page. For installation, authentication, or cross-command
routing, use [mrscraper](../mrscraper/SKILL.md).

## Define the Extraction

Always provide `--prompt`, `--schema`, or both. Promptless `scrape` is only a
deprecated HTML-fetch compatibility alias; use `mrscraper fetch` for page
content.

Start with a concrete prompt:

```bash
mkdir -p .mrscraper
mrscraper scrape "https://books.toscrape.com/" \
  --prompt "Extract every book's title, price, and availability" \
  > .mrscraper/books.json
```

Add a JSON Schema when field names and types must be stable:

```bash
mrscraper scrape "https://example.com/product" \
  --prompt "Extract the product details" \
  --schema ./product.schema.json \
  > .mrscraper/product.json
```

Write prompts that identify:

- the records to collect;
- the exact fields required;
- relevant inclusion or exclusion rules; and
- whether all visible records or only one record is expected.

Do not ask for fields the page cannot reasonably support. Prefer a schema when
downstream code depends on a predictable contract.

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

## Respect API Boundaries

The AI scrape API accepts `--proxy-country <code>`. It does not accept
fetch-only browser controls such as unblock policies, selector waits, homepage
navigation, resource blocking, retry caps, or token caps.

If the task only needs rendered page content, switch to
[mrscraper-fetch](../mrscraper-fetch/SKILL.md). Do not pretend that fetched
content can be piped back into `scrape`; this CLI accepts a URL for extraction.

## Handle Results and Failures

- Save structured output as JSON and check the command exit code.
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
