---
name: mrscraper-fetch
description: Retrieve raw HTML from a known public URL with MrScraper. Use for reading, inspecting, summarizing, archiving, or analyzing a page, and as the default content-acquisition step before agent-led or local extraction. Supports browser rendering, real-device Super Mode, and page-load controls; use SERP when no target URL is known.
---

# Fetch Page Content with MrScraper

Use `fetch` for the first exploration whenever the user already has a public
URL. In agent-led workflows, keep using the raw response for summarization,
comparison, transformation, and structured output rather than handing the page
to another LLM by default. The agent can inspect all available details and write
reusable local extraction logic when needed. Use
[mrscraper](../mrscraper/SKILL.md) for installation, authentication, saved runs,
account status, or command routing.

## Page Retrieval Context

`fetch` uses MrScraper's
[page-fetching service](https://docs.mrscraper.com/docs/features/unblocker) to
retrieve HTML from public pages. Browser rendering executes page JavaScript,
locale routing selects geo-specific country, selector waits allow delayed
content to appear, and homepage navigation establishes a normal navigation
path before loading the target.

Use `fetch` only for content the user is authorized to access and in accordance
with the site's access requirements. Page-loading controls help render blocked sites.

Start with the default request and add only the page-loading controls the target
needs. Plan-token usage is based on runtime and bandwidth: one token
per 30 seconds and one token per 0.2 MB, rounded up per component. Resource
blocking can reduce bandwidth for text-focused pages. Retries stop when the
request succeeds, the retry limit is reached, or the running token total reaches
the token cap. The initial request always runs, even when it exceeds the cap.
See the [Token Plan](https://docs.mrscraper.com/docs/getting-started/api-token)
for the complete calculation.

## Step 1 — Define the Outcome

Confirm the target URL and what the user wants from it:

- Preserve a raw source before extraction, transformation, or comparison;
- Read, summarize, cite, or inspect the page;
- Check whether specific text appears;
- Archive the response;
- Produce fields, JSON, tables, or other structured output with local logic;
- Verify or supplement a scrape or saved result; or
- Load JavaScript-rendered or geo-sensitive content.

Do not call `scrape` merely because the requested output is structured. Fetch
the page, understand its layout, and transform the saved raw content locally.
Use [mrscraper-scrape](../mrscraper-scrape/SKILL.md) only when the user
explicitly requests managed backend extraction, or after fetch-led exploration
has produced a stable output JSON schema and scrape still offers a concrete
benefit. Use [mrscraper-serp](../mrscraper-serp/SKILL.md) when discovery must
happen first.

### Prefer reusable local extraction

When many pages share a layout:

1. Fetch representative pages and inspect their raw content;
2. Define one local extraction schema and implementation;
3. Fetch the remaining pages, in parallel when safe and proportional; and
4. Run the same local extractor across the saved responses.

This preserves every raw input and avoids repeating backend LLM extraction for
each page. Revisit the raw responses when the structure changes or a field is
missing instead of immediately adding more scrape calls.

## Step 2 — Run the Fetch

The command sends `GET https://api.mrscraper.com/` with the target URL and
selected page-loading options.

Save substantial responses inside the user's current project:

```bash
mkdir -p ./.mrscraper
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" \
  > ./.mrscraper/scrapethissite-simple-fetch.json
```

Stdout contains a JSON envelope:

```json
{
  "status_code": 200,
  "data": "<html>...</html>",
  "headers": {
    "content-type": "text/html"
  }
}
```

Extract the HTML when only the page body is needed:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" | jq -r '.data'
```

Check the exit code before using the result. Progress and diagnostics appear on
stderr, so redirected stdout remains machine-readable.

## Step 3 — Choose Page-Loading Options

Browser loading and real-device routing are independent. The same URL can
produce different content or failures in each combination:

| Browser rendering | Super Mode | Command | Loading path |
| --- | --- | --- | --- |
| Off | Off | `mrscraper fetch URL` | Standard routing with the non-browser loader. |
| On | Off | `mrscraper fetch URL --browser-rendering` | Standard routing with browser loading and JavaScript. |
| Off | On | `mrscraper fetch URL --super-mode` | Real-device routing with the non-browser loader. |
| On | On | `mrscraper fetch URL --browser-rendering --super-mode` | Real-device routing with browser loading and JavaScript. |

Use browser rendering when the page depends on JavaScript:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/ajax-javascript/#2015" \
  --browser-rendering
```

Wait for a CSS selector when the required content appears later:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/ajax-javascript/#2015" \
  --browser-rendering \
  --wait-for-selector ".film"
```

Use Super Mode with the non-browser loader when routing may be the problem but
browser loading is unnecessary or produces a worse response:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" \
  --super-mode
```

Use both controls for real-device browser loading:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/ajax-javascript/#2015" \
  --browser-rendering \
  --super-mode
```

Super Mode selects real-device routing and may consume more tokens. It does not
enable browser rendering. Browser rendering is not a strictly stronger mode:
some sites fail or return worse content with it enabled but load successfully
through the non-browser path.

Use geographic routing or homepage navigation when the target requires it:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/simple/" \
  --browser-rendering \
  --geo-code ID \
  --home-page
```

Use geographic routing for geo-specific content

Bound resource use for a browser-rendered page:

```bash
mrscraper fetch "https://www.scrapethissite.com/pages/ajax-javascript/#2015" \
  --browser-rendering \
  --block-resources \
  --max-retries 3 \
  --token-cap 10000 \
  --timeout 60
```

### Parameters

| CLI parameter | Default | Request mapping | Use |
| --- | --- | --- | --- |
| `<url>` | required | Query `url` | Target page URL. |
| `--browser-rendering` | `false` | Query `browserRendering=true` | Load the page in a browser and execute JavaScript. |
| `--super-mode` | `false` | Query `super=true` | Select real-device routing independently of browser rendering. |
| `--geo-code <code>` | omitted | Query `geoCode` | Route the request through an ISO 3166-1 alpha-2 country. |
| `--wait-for-selector <selector>` | omitted | Query `waitForSelector` | Wait for a CSS selector; include `--browser-rendering`. |
| `--home-page` | `false` | Query `homePage=true` | Visit the site root before loading the target page. |
| `--block-resources` | `false` | Query `blockResources=true` | Block non-essential browser resources when supported by the selected proxy. |
| `--max-retries <n>` | `3` | Query `maxRetries` | Set the maximum retry attempts after a failed request; zero is accepted. |
| `--token-cap <n>` | omitted | Query `tokenCap` | Limit the running plan-token total used to decide whether another retry may run; the initial request always runs. |
| `--timeout <seconds>` | `30` | Query `timeout` | Set the page-load timeout; the command allows another 30 seconds to receive the response. |
| `--token <key>` | configured credential | Request headers | Override authentication for this command. |

## Step 4 — Inspect and Retry Deliberately

Start with both controls off unless the task already establishes a requirement.
If the response fails, is blocked, incomplete, or missing dynamic content:

1. Inspect `status_code`, `data`, and relevant response headers;
2. Change one axis at a time: browser rendering for JavaScript, or Super Mode
   when routing may be the problem;
3. If browser rendering fails or returns worse content, retry the same Super
   Mode value without browser rendering;
4. Try the remaining untested combinations when the response is still unusable;
5. Add `--wait-for-selector`, `--geo-code`, or `--home-page` only when evidence
   shows that the target requires it; and
6. Do not repeat an identical combination. Stop after a usable response unless
   the user requests a comparison.

Treat `--wait-for-selector` as a CSS selector, not a duration. Browser
rendering loads a page; it does not click controls, submit forms, or provide an
authenticated interactive browser session.

## Step 5 — Deliver the Result

Answer the user's request from the fetched page and report any saved artifact.
Keep the full envelope when headers or diagnostics matter. For ordinary reading
or summarization, use the HTML in `.data` and present the requested answer in
chat.

Keep fetched content available as the source of truth for later steps. Build
summaries, tables, JSON transformations, and extraction scripts from that raw
content. Fetch again when a follow-up needs details that an earlier local or
managed transformation did not preserve.

If fetch fails and another MrScraper workflow can still complete the task, the
agent may continue, but must disclose that raw page content was not preserved
and must not present the narrower result as exhaustive source content.
