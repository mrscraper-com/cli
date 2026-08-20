---
name: mrscraper-serp
description: Discover public pages through Google with the MrScraper CLI using a search query or Google search URL. Use when the user starts with a topic, product, company, or question but has no target URL; asks to search Google or inspect a result page; or needs relevant URLs before page reading or structured extraction. Supports country, language, pagination, JSON or HTML output, JavaScript rendering, and command timeouts. Use mrscraper-fetch for flexible agent-led work from page HTML or mrscraper-scrape for defined structured extraction once a target URL is known.
---

# Discover Pages with MrScraper SERP

Use `serp` when the task begins with a search query rather than a known target
URL. Use [mrscraper](../mrscraper/SKILL.md) for installation, authentication,
saved runs, account status, or command routing.

The command sends
`POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync`.

## Step 1 — Build the Query

Include the important entity, attribute, location, or date in the query. Quote
the query so the shell preserves spaces:

```bash
mkdir -p ./.mrscraper
mrscraper serp "web scraping best practices" \
  > ./.mrscraper/web-scraping-search.json
```

The input can also be a complete Google search URL:

```bash
mrscraper serp \
  "https://www.google.com/search?q=web+scraping&gl=us&hl=en&start=20" \
  > ./.mrscraper/web-scraping-search.json
```

For a Google URL, the command reads `q`, `gl`, `hl`, and `start`.
Explicit `--region`, `--language`, and `--page` values take precedence.
Always quote URLs so the shell does not interpret `?` or `&`.

## Step 2 — Set Locale and Pagination

Set both country and language when results must match a locale:

```bash
mrscraper serp "running shoes" \
  --region id \
  --language id \
  --page 2 \
  > ./.mrscraper/running-shoes-id.json
```

Start with the first page unless the user requests broader coverage. Inspect
each page before requesting another.

## Step 3 — Choose the Output

Parsed JSON is the default and is suitable for selecting titles, URLs, and
snippets:

```bash
mrscraper serp "iphone 17" --format json
```

Request result-page HTML when the page itself is needed:

```bash
mrscraper serp "iphone 17" --format html \
  > ./.mrscraper/iphone-17-search-html.json
```

Use JavaScript rendering for features such as AI Overview:

```bash
mrscraper serp "what is web scraping" --render-js \
  > ./.mrscraper/web-scraping-rendered.json
```

### Parameters

| CLI parameter | Default | Request mapping | Use |
| --- | --- | --- | --- |
| `<query-or-url>` | required | Body `query` | Search query or complete Google search URL. |
| `--region <code>` | omitted | Body `region` | Google result country, such as `us` or `id`. |
| `--language <code>` | omitted | Body `language` | Google result language, such as `en` or `id`. |
| `--page <n>` | omitted | Body `page` | Positive, 1-based result page. |
| `--format <json\|html>` | `json` | Body `format` | Return parsed JSON or result-page HTML. |
| `--render-js` | `false` | Body `renderJs=true` | Wait for JavaScript-rendered result features. |
| `--raw` | `false` | Body `format=html` | Deprecated alias for `--format html`. |
| `--client-timeout <seconds>` | `120` | Command request | Set the HTTP request deadline. |
| `--token <key>` | configured credential | Request headers | Override authentication for this command. |

## Step 4 — Inspect the Results

Stdout contains a JSON response envelope. For `--format json`, inspect the
parsed result data for titles, URLs, snippets, and other available fields. For
`--format html`, the response data contains the result-page HTML.

Check the exit code and save substantial output under `./.mrscraper/`.
Progress and diagnostics appear on stderr.

## Step 5 — Continue with Relevant URLs

Select only URLs relevant to the user's goal, then:

- Load [mrscraper-fetch](../mrscraper-fetch/SKILL.md) to read, summarize, cite,
  inspect, archive, or flexibly analyze selected pages; or
- Load [mrscraper-scrape](../mrscraper-scrape/SKILL.md) to extract requested
  fields or repeated records.

Run independent follow-up URLs in parallel when the environment supports safe
parallel execution. Keep the number of pages proportional to the requested
coverage.

## Step 6 — Handle Weak or Missing Results

- Set both `--region` and `--language` when the locale is wrong.
- Rewrite noisy queries with the important entity, attribute, and location.
- Request another result page only after checking the current page.
- Retry once with `--render-js` when a JavaScript-rendered result feature is
  required.
- Increase `--client-timeout` when the request deadline is too short.
- Use the [mrscraper](../mrscraper/SKILL.md) skill when authentication fails.

SERP is for public Google discovery. Use the map agent in
[mrscraper-scrape](../mrscraper-scrape/SKILL.md) to discover URLs within one
known site.
