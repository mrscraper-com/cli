---
name: mrscraper-serp
description: |
  Discover pages through Google with the MrScraper CLI using a search query or Google search URL, returning parsed JSON results or raw result-page HTML with locale, pagination, and optional JavaScript rendering controls. Use when the user starts with a topic, product, company, or question but no known target URL; asks to search Google or inspect a SERP; or needs relevant URLs before fetching or structured extraction. Do not use when the target URL is already known.
---

# Discover Pages with MrScraper SERP

Use `serp` when the task begins with a query rather than a known target URL. For
installation, authentication, or cross-command routing, use
[mrscraper](../mrscraper/SKILL.md).

## Search Google

JSON is the default output:

```bash
mkdir -p .mrscraper
mrscraper serp "web scraping best practices" > .mrscraper/search.json
```

Localize results when geography or language matters:

```bash
mrscraper serp "running shoes" \
  --region id --language id --page 2 \
  > .mrscraper/running-shoes-id.json
```

The input may also be a complete Google search URL:

```bash
mrscraper serp \
  "https://www.google.com/search?q=web+scraping&gl=us&hl=en"
```

Quote both queries and URLs so the shell does not interpret spaces, `?`, or
`&`.

## Choose the Result Format

Use parsed JSON for normal discovery and downstream processing. Request raw
HTML only when the user explicitly needs the result page itself:

```bash
mrscraper serp "web scraping" --format html > .mrscraper/search.html.json
```

Use `--render-js` only for JavaScript-rendered SERP features such as an AI
Overview:

```bash
mrscraper serp "what is web scraping" --render-js \
  > .mrscraper/search-rendered.json
```

`--format` and `--render-js` are real SERP API body fields. `--raw` is a
deprecated CLI alias that sends `format=html`. Increase the CLI-only
`--client-timeout <seconds>` only when the HTTP request genuinely needs more
time; it is not sent in the API body.

## Continue with Selected Results

Do not fetch every result by default. Inspect the titles, URLs, and snippets;
select sources relevant to the user's goal; then:

- load [mrscraper-fetch](../mrscraper-fetch/SKILL.md) to read, summarize, cite,
  or archive selected pages; or
- load [mrscraper-scrape](../mrscraper-scrape/SKILL.md) to extract defined
  fields or repeated records from selected pages.

Use additional SERP pages only when the requested coverage requires them.

## Handle Results and Failures

- Save JSON output under `.mrscraper/` and check the exit code.
- If results have the wrong locale, set both `--region` and `--language`.
- If the query is noisy, rewrite it with the important entity, attribute, and
  location instead of fetching more pages indiscriminately.
- If a dynamic SERP feature is absent, retry once with `--render-js`.
- If a Google URL already specifies `gl`, `hl`, or pagination, preserve the
  user's intent rather than silently substituting another locale.
- If authentication fails, use the `mrscraper` router skill.

SERP discovers public search results; it is not site mapping, traffic analytics,
or an interactive Google browser session.
