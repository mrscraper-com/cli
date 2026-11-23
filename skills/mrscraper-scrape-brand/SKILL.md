---
name: mrscraper-scrape-brand
description: Extract a website's brand identity with the MrScraper CLI's scrape-brand command, including colors, typography, logos, icons, social links, and metadata as JSON. Use for brand audits, design references, competitor research, or populating a style guide from a known URL.
---

# Scrape a Brand with MrScraper

`mrscraper scrape-brand <url>` returns the brand identity of a website as JSON.
It sends `GET https://api.mrscraper.com` with `action=brand-scraping` and
`bundle=none` added automatically, always sends `warmStart`, and sends
`timeout` and `geoCode` only when you set them. See
[mrscraper](../mrscraper/SKILL.md) for installation, authentication, and
account status.

## Extract and Save a Brand

```bash
mkdir -p ./.mrscraper
mrscraper scrape-brand "https://mrscraper.com/" > ./.mrscraper/brand.json
mrscraper scrape-brand "https://mrscraper.com/" --geo-code gb --warm-start \
  --timeout 120 > ./.mrscraper/brand-gb.json
jq '.data.data.brand.colors' ./.mrscraper/brand.json
jq -r '.data.data.job_id' ./.mrscraper/brand.json
```

The CLI prints a JSON envelope. The brand is in `data.data.brand`, with the
job ID in `data.data.job_id`, the settled job status in `data.data.status`,
and the resolved address in `data.data.final_url`.

## Options

| Option | Default | Request field |
| --- | --- | --- |
| `<url>` | Required | `url`, an absolute HTTP or HTTPS URL. |
| `--timeout SECONDS` | Omitted | `timeout`, 1–330. The HTTP request allows 30 more seconds, or 330 seconds when omitted. |
| `--warm-start` | Off | `warmStart`: open the site's home page first to warm the session. |
| `--geo-code CODE` | Omitted | `geoCode`: two-letter country to load the page from. The API uses the United States when omitted. |
| `--token KEY` | Configured credential | Authentication override, sent in headers. |

Page bundles and caching options are not available for this command.

## Inspect and Continue

Check the exit status, `status_code`, and `data.data.status` before using the
brand; the CLI exits nonzero when the job status is `failed` or the job reports
an error. HTTP 422 with a settled job means the page has no usable brand data;
it is not charged. Brand fields can be `null` when a site does not declare
them, so treat missing colors, fonts, or logos as absent rather than as errors.

The command follows the [Scrape Brand reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-brand/scrape-brand).
