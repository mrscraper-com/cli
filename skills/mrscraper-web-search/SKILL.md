---
name: mrscraper-web-search
description: Search the web to retrieve real-time search results, including relevant website URLs, titles, descriptions, and related questions based on a given query. Use MrScraper webSearch with a query, then retrieve selected pages with scraperHtml or scraperMarkdown for reading and analysis.
---

# Web Search

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
Search the web to retrieve real-time search results, including relevant website URLs, titles, descriptions, and related questions based on a given query. Available fields depend on the returned search features.

```bash
mrscraper webSearch "web scraping best practices" --region us --language en
mrscraper webSearch "books" --region id --language en --page 2
```

The required argument is the search query. The CLI requests parsed JSON by
default. Use `--format html` or `--raw` for HTML. Set `--region` and `--language`
to select the country and language. Use `--page` to select a results page,
starting at 1. `--render-js` enables dynamic search features. `--timeout`
sets the request deadline and defaults to 600 seconds.
`--client-timeout` is a compatibility alias.

Search results identify candidate sources. Retrieve relevant result URLs with
[mrscraper-scraper-api](../mrscraper-scraper-api/SKILL.md) before drawing
conclusions that require full page content. Keep the source URL with any
saved result used for analysis or citations.
