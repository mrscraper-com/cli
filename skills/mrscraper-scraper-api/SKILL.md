---
name: mrscraper-scraper-api
description: Retrieve a known page as HTML, Markdown, or a screenshot with MrScraper scraperAPI. Use for reading, summarizing, inspecting, archiving, and acquiring page content for local extraction; use web search to discover URLs.
---

# Retrieve page content

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`scraperAPI` sends `POST https://api.mrscraper.com`. The JSON body contains
`url`, `maxRetries`, and optional `tokenCap`; page controls are query parameters.

```bash
mrscraper scraperAPI "https://books.toscrape.com/" --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --no-html --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --screenshot --super
```

HTML defaults to enabled, Markdown to disabled, timeout to 120 seconds, and
geolocation to `US`. Omit browser-rendering flags for automatic fallback.
`--screenshot` forces browser rendering, including when `--no-browser-rendering`
is supplied. `--super` selects real-device routing independently.

| Controls | Purpose |
| --- | --- |
| `--browser-rendering`, `--no-browser-rendering` | Explicit browser rendering policy |
| `--geo-code`, `--proxy-country`, `--proxy`, `--no-use-proxy` | Locale and proxy routing |
| `--wait-for-selector` | Wait for delayed page content |
| `--home-page` | Visit the site root first via `warmStart=true` |
| `--block-resources`, `--bypass-proxy`, `--cookie-jar` | Page resource and session controls |
| `--headers <json>` | Headers forwarded to the target site |
| `--max-retries`, `--token-cap` | Retry count and token budget; zero is accepted |
| `--timeout <seconds>` | Page deadline from 1 to 300 seconds |
| `--stream`, `--no-stream` | Explicit streaming preference |

The response is `{ status_code, data, headers }`; `data` may be text or a
structured API payload depending on requested formats. Inspect it before
assuming HTML is directly in `data`. Preserve the source when extracting
structured fields locally, and reuse extraction code across pages with the
same layout. Use account status when checking available quota.
