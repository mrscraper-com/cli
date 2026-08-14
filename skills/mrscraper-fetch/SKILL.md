---
name: mrscraper-fetch
description: |
  Fetch and read content from a known URL with the MrScraper CLI, returning Markdown, HTML, or a page-document JSON payload with automatic unblocking and browser rendering when needed. Use when the user provides a URL and wants its page content to read, summarize, cite, inspect, or archive, or when a direct request encounters a challenge page, 403, 429, missing dynamic content, or geo-sensitive response. Do not use for requested fields or structured records; use mrscraper-scrape. Do not use for query-first discovery; use mrscraper-serp.
---

# Fetch Page Content with MrScraper

Use `fetch` when a target URL is already known and the output should be the page
itself rather than selected fields. For installation, authentication, or
cross-command routing, use [mrscraper](../mrscraper/SKILL.md).

## Fetch a Page

Create a local output directory when the result should persist:

```bash
mkdir -p .mrscraper
mrscraper fetch "https://example.com" > .mrscraper/example.json
```

Markdown is the default. The CLI writes a JSON envelope to stdout; extract the
formatted page from `.data`:

```bash
mrscraper fetch "https://example.com" | jq -r '.data'
```

Choose another representation only when required:

```bash
mrscraper fetch "https://example.com" \
  --format html > .mrscraper/example-html.json

mrscraper fetch "https://example.com" \
  --format json > .mrscraper/example-document.json
```

- `markdown` returns readable content for reasoning and summarization.
- `html` returns page HTML.
- `json` returns MrScraper's page-document representation.

## Escalate Unblocking Progressively

Start with the default `auto` policy. It attempts the lower-cost path and
escalates when MrScraper detects a likely block:

```bash
mrscraper fetch "https://example.com" --unblock auto
```

Force browser rendering when the response is a challenge page, blocked,
incomplete, or dependent on client-side rendering:

```bash
mrscraper fetch "https://example.com" --unblock always
```

Wait for a dynamic element when browser rendering starts before the required
content appears:

```bash
mrscraper fetch "https://example.com/products" \
  --unblock always --wait-for ".product-card"
```

Treat `--wait-for` as a CSS selector, not a duration.

Add only the controls the target requires:

```bash
# Route through Indonesia
mrscraper fetch "https://example.com" --unblock always --geo ID

# Establish site cookies from the home page first
mrscraper fetch "https://example.com/product" \
  --unblock always --homepage

# Reduce non-essential browser traffic and keep retry work bounded
mrscraper fetch "https://example.com" \
  --unblock always --block-resources --retries 3 --token-cap 10000
```

Use `--timeout <seconds>` for a genuinely slow page. Keep retries and token caps
bounded instead of repeatedly retrying an inaccessible target.

## Choose the Correct Boundary

- Use `fetch` for page content to read, summarize, cite, compare, or archive.
- Use [mrscraper-scrape](../mrscraper-scrape/SKILL.md) when the user requests
  particular fields, repeated records, listings, or an explicit JSON shape.
- Use [mrscraper-serp](../mrscraper-serp/SKILL.md) when no target URL is known.
- Do not claim that browser rendering supports clicks, form entry, login, or an
  interactive session.

## Handle Results and Failures

- Quote every URL because query parameters contain shell metacharacters.
- Keep JSON on stdout intact; send extracted Markdown to a separate file or
  pipe `.data` through `jq`.
- Check the exit code before trusting output.
- For 401, authenticate through the `mrscraper` router skill.
- For 403, 429, a challenge page, or incomplete content, use
  `--unblock always` before adding geo, homepage, or selector controls.
- For missing dynamic content, combine `--unblock always` with the narrowest
  stable CSS selector.
- For repeated failures, stop and report the target and attempted escalation;
  do not create an unsupported interaction workflow.

Keep `.mrscraper/` out of version control unless the user asks to commit the
artifacts.
