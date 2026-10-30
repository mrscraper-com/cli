# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

MrScraper CLI for page HTML, Markdown, screenshots, structured extraction, site maps, brand assets, Web Search, and account status.
Requires Node.js 20 or newer.

## Install and authenticate

```bash
npm install -g @mrscraper/cli@latest
mrscraper login
```

Browser sign-in exchanges a one-time code for an API key and saves it in
`~/.mrscraper/auth.json`. Use `login --no-open` to print the sign-in URL on a
machine where the browser must be opened manually. Agents should keep login
running while the user approves the browser request.

For CI, containers, or headless automation, configure an API key:

```bash
export MRSCRAPER_API_KEY="YOUR_API_KEY"
```

Get keys from [MrScraper API tokens](https://app.mrscraper.com/api-tokens).
`MRSCRAPER_API_TOKEN` is also supported. Authentication precedence is explicit
`--token`, then `MRSCRAPER_API_KEY` or `MRSCRAPER_API_TOKEN`, then the saved key.
`login --api-key` explicitly saves a key; `login --no-browser` prompts only in
an interactive terminal.

```bash
mrscraper auth status --json
mrscraper account --json
mrscraper logout
```

`auth status` reports local credential configuration. `account` checks the
remote account. `logout` removes local credentials.

To run this checkout:

```bash
npm install
node bin/mrscraper.js --help
```

## Agent setup

Install the CLI and the four repository-hosted skills for detected agents:

```bash
npx -y @mrscraper/cli@latest init --all
```

For agent-driven setup, skip interactive authentication and run login separately
when required:

```bash
npx -y @mrscraper/cli@latest init --all --yes --skip-auth
mrscraper auth status --json
mrscraper login
```

The skill pack contains:

- [mrscraper](./skills/mrscraper/SKILL.md): setup, authentication, routing, and output.
- [mrscraper-scraper-api](./skills/mrscraper-scraper-api/SKILL.md): retrieve page content.
- [mrscraper-web-search](./skills/mrscraper-web-search/SKILL.md): discover pages with Web Search.
- [mrscraper-account](./skills/mrscraper-account/SKILL.md): account status and quota.

Supported harness IDs are `claude-code`, `cursor`, `codex`, `grok`, `hermes`,
`opencode`, `openclaw`, `pi`, and `omp`. Refresh or preview installation with:

```bash
mrscraper setup skills --agent codex
mrscraper setup skills --all --dry-run
```

`init` also supports `--skip-install`, `--skip-skills`, and `--api-key`.
Skills are hosted in this repository and installed with the public `skills`
installer; they are excluded from the npm package.

## Scraping services

Fetch public web pages as HTML, Markdown, or screenshots. Enable browser
rendering for pages that need JavaScript; screenshots always use browser
rendering. The services also support structured data extraction, listing
pagination, site URL discovery, and brand asset extraction.

Each operation selects its output automatically. To collect multiple formats
for a page, run the corresponding commands for the same URL. `scraperAPI` is
an internal transport and is no longer a public command or package export.

```bash
mrscraper scraperHtml "https://books.toscrape.com/"
mrscraper scraperMarkdown "https://books.toscrape.com/" --home-page
mrscraper getScreenshot "https://books.toscrape.com/" --save page.png
mrscraper scraperJson "https://books.toscrape.com/" --prompt "Extract all book titles and prices."
mrscraper scraperMultiplePage "https://books.toscrape.com/" --max-pages 3
mrscraper scraperSitemap "https://docs.mrscraper.com" --max-depth 2 --max-pages 3 --limit 1000 --include-patterns '/docs/*' --exclude-patterns '/private/*'
mrscraper scrapeBrand "https://www.brooksrunning.com" --bundle clean
mrscraper getBrand "<job_id>"
mrscraper getBrand "<job_id>" --output bundle --save brand.zip
```

Snake-case command aliases match the Python SDK: `scraper_html`,
`scraper_markdown`, `get_screenshot`, `scraper_json`, `scraper_multiple_page`,
`scraper_sitemap`, `scrape_brand`, and `get_brand`.

| Operation | Description | Parameters and defaults |
| --- | --- | --- |
| `scraperHtml` | Fetch a public web page as HTML. | Required URL and shared scraping options |
| `scraperMarkdown` | Fetch a public web page as Markdown for reading and analysis. | Required URL and shared scraping options |
| `getScreenshot` | Capture a public web page as a rendered screenshot. | Full-page capture, `--wait-until domcontentloaded`, timeout 300; use `--no-full-page` for the viewport |
| `scraperJson` | Extract structured data from a page using a prompt. | `--prompt` defaults to `Extract all data as complete as possible.` |
| `scraperMultiplePage` | Extract listing entries across multiple pages. | `--max-pages 3`; `--prompt` defaults to `Extract all entry data as complete as possible.` |
| `scraperSitemap` | Discover site URLs with optional include and exclude patterns. | `--max-depth 2`, `--max-pages 3`, `--limit 1000`; optional pattern filters |
| `scrapeBrand` | Start a job to extract brand assets from a public website. | Required URL; `--bundle clean` (`clean`, `full`, or `none`) |
| `getBrand` | Read a brand job or download its HTML, ZIP bundle, or screenshot. | Required job ID; optional `--output html`, `bundle`, `screenshot`, or `screenshot_full`; timeout 600 |

Use the job ID returned by `scrapeBrand` with `getBrand` to check the job and
retrieve its outputs. Each `getBrand` invocation makes one request; repeat it
to check a job that is still processing. `--bundle` accepts `clean`, `full`,
or `none`.

All data commands use your configured API token. Sitemap pattern strings
are preserved unchanged; omitted patterns leave results unfiltered.

The following controls apply to the initial scraping services. Browser
rendering flags apply to every initial service except `getScreenshot`, which
always renders. `getBrand` accepts only `--output`, `--save`, `--timeout`, and
`--token`.

| Option | Default | Purpose |
| --- | --- | --- |
| `--browser-rendering`, `--no-browser-rendering` | omitted; API default | Explicit rendering policy; screenshots always render |
| `--super` | off | Real-device routing |
| `--geo-code <code>` | `US` | Geolocation |
| `--proxy-country <code>`, `--proxy <url>`, `--no-use-proxy` | API defaults | Proxy controls |
| `--wait-for-selector <selector>`, `--wait-until <event>` | omitted | Wait for page readiness; screenshot readiness defaults as above |
| `--home-page` | off | Visit the site root before the target page |
| `--block-resources`, `--bypass-proxy` | off | Resource and proxy controls |
| `--cookie-jar <settings>`, `--headers <json>` | omitted | Session settings and target headers |
| `--max-retries <n>`, `--token-cap <n>` | `3`, omitted | Nonnegative retry count and token budget, including zero |
| `--timeout <seconds>` | `120` (`300` for screenshot) | Page deadline from 1 to 300 seconds; HTTP transport allows 30 seconds extra |
| `--stream`, `--no-stream` | API default | Streaming preference |
| `--discard-token-secret <secret>` | omitted | Discard-token header |
| `--token <key>` | configured credential | Authentication override |
| `--save <path>` | omitted | Save response data as text, JSON, or unchanged binary bytes |

All data commands print a JSON response wrapper. Binary image/ZIP responses
appear in `data` as `{ encoding: "base64", content, byte_length }`. On scraping
commands, `--save` writes the original bytes and reports `saved_to`. If the API
returns JSON metadata instead of a file, that JSON is saved and returned as
provided.

## Web Search

Search the web to retrieve real-time search results, including relevant
website URLs, titles, descriptions, and related questions based on a given
query. Available fields depend on the query and returned search features.

```bash
mrscraper webSearch "web scraping best practices" --region us --language en
mrscraper webSearch "books" --region id --language en --page 2
mrscraper webSearch "books" --format html --render-js
```

The CLI requests parsed JSON by default. `--format html` requests HTML;
`--raw` is a shorthand for that format. `--region` and `--language` set the
country and language. `--page` selects a results page, starting at 1.
`--render-js` enables dynamic search features. `--timeout` defaults to 600
seconds and sets the request deadline.
`--client-timeout` remains a compatibility alias.

## Account

```bash
mrscraper account
mrscraper account --json
mrscraper account --pretty --no-color
```

Check the account associated with your configured API token. The summary includes identity,
verification state, subscription status, token usage, token limit, remaining
tokens, usage percentage, rate limit, renewal settings, and subscription end
date. API keys and billing identifiers are excluded. Remaining tokens are
clamped to zero for over-quota accounts. `--timeout` defaults to 30 seconds.

Interactive terminals show a dashboard by default. Use `--json` for scripts
or `--pretty` to force the dashboard. Redirected output is JSON.

## Public API and migration

CLI data commands print `{ status_code, data, headers }`. Account JSON places
the summary at `data.account`. Failed HTTP or network requests exit nonzero
and include `error`; progress uses stderr. Programmatic services return an
error result for HTTP or network failures and throw for invalid arguments
or missing authentication. Sensitive response headers are removed.

Replace `scraperAPI --markdown` with `scraperMarkdown`, plain page retrieval
with `scraperHtml`, and screenshots with `getScreenshot`. The old generic
command and output flags are removed from the public interface. Login, auth,
init, and setup remain configuration commands.

Import the service functions from the package:

```js
import { scraperHtml, scraperMarkdown, getScreenshot, scraperJson,
  scraperMultiplePage, scraperSitemap, scrapeBrand, getBrand,
  webSearch, account } from "@mrscraper/cli";

const token = process.env.MRSCRAPER_API_KEY || process.env.MRSCRAPER_API_TOKEN;
const page = await scraperMarkdown({ token, url: "https://books.toscrape.com/" });
const data = await scraperJson({ token, url: "https://books.toscrape.com/", prompt: "Extract all books." });
const map = await scraperSitemap({ token, url: "https://docs.mrscraper.com", includePatterns: "/docs/*", excludePatterns: "/private/*" });
const brand = await getBrand({ token, jobId: "<job_id>", output: "bundle" });
const results = await webSearch({ token, query: "books", raw: false, format: "json" });
const status = await account({ token, timeout: 30 });
console.log(status.data.token_remaining);
```

Programmatic calls require an explicit `token` and do not load saved CLI
credentials or `.env` files automatically. Programmatic account results put
the summary directly in `data`. Binary
responses remain Node.js `Buffer` values in `data`. CLI options use kebab-case
flags; programmatic options use camelCase, including `browserRendering`,
`homePage`, `maxRetries`, `tokenCap`, `fullPage`, `maxPages`, `maxDepth`,
`includePatterns`, `excludePatterns`, and `jobId`. `webSearch` defaults to
`raw: true`, like the SDKs; set `raw: false` for parsed JSON.

## Publish to npm manually

This checkout prepares documentation patch **0.5.1**. Version **0.5.0** is
already published. Publishing is manual; pushing this branch does not publish
to npm. From the repository root, validate and preview the package:

```bash
npm test
npm pack --dry-run
npm publish --dry-run --access public
```

After committing and pushing the release files, publish with your npm account:

```bash
npm login
npm whoami
npm publish --access public
npm view @mrscraper/cli version
```

Complete npm's browser authentication and two-factor challenge when prompted.
Each version can be published only once. For later releases, update both
`package.json` and `package-lock.json` with `npm version patch` or
`npm version minor`, then validate the package again.

## Development

```bash
npm test
npm pack --dry-run
```

Tests use local HTTP mocks and require no API token. Run `node scripts/harness-smoke.mjs codex` to verify
an already installed package through the page/search/account mock workflow.

### Manual real API testing

To test the CLI itself from this checkout with a real token:

```bash
export MRSCRAPER_API_TOKEN="YOUR_API_TOKEN"

node bin/mrscraper.js account --json
node bin/mrscraper.js scraperMarkdown "https://books.toscrape.com/"
node bin/mrscraper.js webSearch "books to scrape"
```

The CLI also loads a project `.env` file or credentials saved by `login`.

Run one function from this checkout at a time with your own API token:

```bash
export MRSCRAPER_API_TOKEN="YOUR_API_TOKEN"

node scripts/manual-real.mjs account
node scripts/manual-real.mjs scraperMarkdown
node scripts/manual-real.mjs webSearch
```

`MRSCRAPER_API_KEY` is also supported and takes precedence if both are set.
The page test requests Markdown from `https://books.toscrape.com/`;
the search test requests parsed JSON for `books to scrape`. Override the input:

```bash
node scripts/manual-real.mjs scraperMarkdown "https://example.com/"
node scripts/manual-real.mjs webSearch "web scraping Indonesia"
node scripts/manual-real.mjs --help
```

Responses are printed as JSON and saved to `.mrscraper/manual/<operation>.json`,
including API failures. Repeating an operation replaces its previous output.
These artifacts are ignored by Git. Failed operations exit nonzero.
This script uses the live services. Page and search requests can consume your API quota.

## License

MIT — see [LICENSE](./LICENSE).
