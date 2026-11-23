---
name: mrscraper-web-search
description: Discover public URLs with the MrScraper CLI's web-search command. Use when a task begins with a query, topic, product, company, or question rather than a known URL; retrieve the relevant results with the focused scraping skills.
---

# Search the Web with MrScraper

`mrscraper web-search <query>` returns ranked results with titles, URLs,
descriptions, and sources. It sends `GET https://api.mrscraper.com` with
`action=websearch` added automatically. See [mrscraper](../mrscraper/SKILL.md)
for installation, authentication, and account status.

## Search and Save Results

Include the important entity, attribute, location, or date in the query, and
quote it to preserve spaces:

```bash
mkdir -p ./.mrscraper
mrscraper web-search "e-menessaptieka.lv linkedin" > ./.mrscraper/search.json
mrscraper web-search "running shoes" \
  --country id --num-results 20 > ./.mrscraper/running-shoes-id.json
jq -r '.data.data[] | "\(.rank). \(.title) \(.url)"' ./.mrscraper/search.json
```

The CLI prints a JSON envelope. Results are in `data.data`, each with `rank`,
`title`, `url`, `description`, and `source`; `data.tokenUsage` reports the
tokens used. Fewer results than requested may be returned.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<query>` | Required | `query`, trimmed, 1–1000 characters. |
| `--country CODE` | Omitted | `country`: two-letter country to search from. The API uses the United States when omitted. |
| `--num-results N` | `10` | `numResults`: integer from 10 to 100. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

The HTTP request waits up to 120 seconds. Search URL parsing and the legacy
`--region`, `--language`, `--page`, `--format`, `--render-js`, and
`--timeout` options are not supported.

## Continue with Relevant URLs

Select the URLs relevant to the user's goal, then retrieve them:

- Use [mrscraper-scrape-markdown](../mrscraper-scrape-markdown/SKILL.md) to read page text.
- Use [mrscraper-scrape-html](../mrscraper-scrape-html/SKILL.md) when the page structure matters.
- Use [mrscraper-scrape-json](../mrscraper-scrape-json/SKILL.md) for named fields.

If the user only asked for URLs, finish with the search results. For weak
results, refine the query or country based on the response, and increase
`--num-results` only when broader coverage is useful.

The command follows the [Web Search reference](https://docs.mrscraper.com/docs/api/web-search/web-search).
