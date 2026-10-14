---
name: mrscraper-web-search
description: Find public pages through Google using MrScraper webSearch. Use for query-based discovery or a Google search URL, then retrieve selected pages with scraperAPI for reading and analysis.
---

# Search Google

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`webSearch` sends `POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync`.

```bash
mrscraper webSearch "web scraping best practices" --region us --language en
mrscraper webSearch "https://www.google.com/search?q=books&gl=id&hl=en&start=10"
```

The CLI requests parsed JSON by default. Use `--format html` for the raw page.
Google URLs supply `q`, `gl`, `hl`, and `start`; explicit `--region`,
`--language`, and `--page` override URL-derived values. Pages are one-based;
`start=10` selects page 2. `--render-js` enables dynamic search features.
`--client-timeout` controls the HTTP deadline and is excluded from the body.

Search results identify candidate sources. Retrieve relevant result URLs with
[mrscraper-scraper-api](../mrscraper-scraper-api/SKILL.md) before drawing
conclusions that require full page content. Keep the source URL with any
saved result used for analysis or citations.
