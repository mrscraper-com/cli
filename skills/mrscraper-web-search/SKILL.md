---
name: mrscraper-web-search
description: "Search the web for real-time results: website URLs, titles, and descriptions. Use MrScraper webSearch with a query, then fetch selected pages with scraperAPI for reading and analysis."
---

# Web Search

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`webSearch` searches the web for real-time results: website URLs, titles, and descriptions.

```bash
mrscraper webSearch "e-menessaptieka.lv linkedin" --country us --num-results 10
mrscraper webSearch "web scraping best practices"
```

The required argument is the search query. `--country` sets a country code
for localized results, such as `us`; when omitted, the service default
applies. `--num-results` must be an integer from 10 to 100 and defaults to
10. `--timeout` sets the request deadline and defaults to 600 seconds.

The response is `{ status_code, data, headers }`. `data` contains `success`,
`message`, and `data`; each result in `data.data` has `rank`, `title`, `url`,
`description`, and `source`.

Search results identify candidate sources. Fetch relevant result URLs with
[mrscraper-scraper-api](../mrscraper-scraper-api/SKILL.md) before drawing
conclusions that require full page content. Keep the source URL with any
saved result used for analysis or citations.
