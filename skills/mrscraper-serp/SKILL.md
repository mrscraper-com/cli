---
name: mrscraper-serp
description: Discover public URLs with the MrScraper CLI's web-search command. Use when a task begins with a query, topic, product, company, or question rather than a known target URL; retrieve selected pages with the focused scraping commands for reading and analysis.
---

# Discover Pages with MrScraper Web Search

Use `mrscraper web-search` for query-first discovery. Use
[mrscraper](../mrscraper/SKILL.md) for installation, authentication, and account
status. The command sends GET `https://api.mrscraper.com` with query fields
`action=websearch`, `query`, `country`, and `numResults`.

## Search and Preserve Results

Include the important entity, attribute, location, or date in the query. Pass
query text and quote it to preserve spaces:

```bash
mkdir -p ./.mrscraper
mrscraper web-search "e-menessaptieka.lv linkedin" \
  --country us --num-results 10 > ./.mrscraper/search.json
mrscraper web-search "running shoes" \
  --country id --num-results 20 > ./.mrscraper/running-shoes-id.json
```

| Option | Default | Request mapping |
| --- | --- | --- |
| `<query>` | Required | `query`, 1–1000 characters. |
| `--country CODE` | `us` | `country`, a two-letter country code. |
| `--num-results N` | `10` | `numResults`, integer from 10 to 100. |
| `--token KEY` | Configured credential | Authentication override. |

The CLI returns a JSON envelope with `status_code`, API response in `data`,
and sanitized `headers`. Check the exit code and inspect the saved response
before using results. Fewer results may be returned than requested. Progress
and diagnostics appear on stderr.

Google search URL parsing and legacy options `--region`, `--language`,
`--page`, `--format`, `--render-js`, and `--timeout` are not supported.

## Continue with Relevant URLs

Select URLs relevant to the user's goal, then use
[mrscraper-fetch](../mrscraper-fetch/SKILL.md) to retrieve pages whose content
will inform the answer. Preserve raw responses for analysis. If the user only
requested URL discovery, finish with the search results.

For weak results, refine the query or country based on the response. Increase
`--num-results` only when broader coverage is useful. Use the main skill when
authentication fails.
