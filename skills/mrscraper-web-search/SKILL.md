---
name: mrscraper-web-search
description: Search the web to retrieve real-time search results, including relevant website URLs, titles, descriptions, and related questions based on a given query. Use MrScraper webSearch with a query or Google search URL, then retrieve selected pages with scraperHtml or scraperMarkdown for reading and analysis.
---

# Search Google

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`webSearch` retrieves live Google search results, including website URLs,
titles, descriptions, and related questions when available in the results.
`webSearch` sends `POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync`.

```bash
mrscraper webSearch "web scraping best practices" --region us --language en
mrscraper webSearch "https://www.google.com/search?q=books&gl=id&hl=en&start=10"
```

The CLI requests parsed JSON by default. Use `--format html` for the raw page.
Google URLs supply `q`, `gl`, `hl`, and `start`; explicit `--region`,
`--language`, and `--page` override URL-derived values. Pages are one-based;
`start=10` selects page 2. `--render-js` enables dynamic search features.
`--timeout` controls the HTTP deadline, defaults to 600 seconds, and is excluded
from the body. `--client-timeout` is a compatibility alias.

Search results identify candidate sources. Retrieve relevant result URLs with
[mrscraper-scraper-api](../mrscraper-scraper-api/SKILL.md) before drawing
conclusions that require full page content. Keep the source URL with any
saved result used for analysis or citations.
