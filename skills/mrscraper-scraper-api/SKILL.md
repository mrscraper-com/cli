---
name: mrscraper-scraper-api
description: Fetch a public web page as rendered HTML, Markdown, screenshot, or a combination with the MrScraper scraperAPI command. Use it to read page content after setup, optionally with browser rendering, geolocation, proxies, cookies, or custom target headers.
---

# Scraper API

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`scraperAPI` fetches a public web page as rendered HTML, Markdown, screenshot,
or a combination.

```bash
mrscraper scraperAPI "https://books.toscrape.com/"
mrscraper scraperAPI "https://books.toscrape.com/" --no-html --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --markdown --screenshot
mrscraper scraperAPI "https://books.toscrape.com/" --save ./.mrscraper/page.html
```

HTML is included by default; add `--markdown` or `--screenshot`, or use
`--no-html` to omit HTML. At least one output must remain selected. Prefer
`--no-html --markdown` for reading and analysis. `--screenshot` always enables
browser rendering.

The response is `{ status_code, data, headers }`. With HTML only, `data` is
the page HTML string. With Markdown or a screenshot, `data` is an object with
an entry per requested output, such as `html`, `markdown`, and `screenshot`
(base64-encoded image). `--save <path>` writes `data` to a file (HTML as text,
combined outputs as JSON), creates parent directories, and adds `saved_to` to
stdout.

Defaults: timeout 120 seconds (1–300), geolocation `US`, `--max-retries 3`,
and the API's browser rendering policy. Options include
`--browser-rendering`, `--no-browser-rendering`, `--super` (real-device
routing), `--geo-code`, `--proxy-country`, `--proxy`, `--no-use-proxy`,
`--wait-for-selector`, `--wait-until`, `--home-page` (visit the site root
first), `--block-resources`, `--bypass-proxy`, `--cookie-jar`,
`--headers <json>`, `--stream`, `--no-stream`, `--token-cap`, and
`--discard-token-secret`. Retry counts and token caps accept zero.

Save source content when subsequent local extraction needs it, and keep the
source URL with saved content. Use account status to check quota before a
large job.
