# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

MrScraper CLI for the Scraper API, Web Search, and account status.
Requires Node.js 20 or newer.

| Command | Purpose |
| --- | --- |
| `scraperAPI <url>` | Fetch a public web page as rendered HTML, Markdown, screenshot, or a combination. |
| `webSearch <query>` | Searches the web to retrieve real-time results, including relevant website URLs, titles, descriptions, and related questions based on a given query. |
| `account` | Check account identity, subscription, token quota, and rate limits. |

Login, auth, init, and setup are configuration commands.

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
- [mrscraper-scraper-api](./skills/mrscraper-scraper-api/SKILL.md): fetch page HTML, Markdown, or screenshots.
- [mrscraper-web-search](./skills/mrscraper-web-search/SKILL.md): find pages with Web Search.
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

## Scraper API

Fetch a public web page as rendered HTML, Markdown, screenshot, or a
combination. Common controls support JavaScript rendering, geolocation,
proxies, cookies, custom target headers, and waiting for page content.

```bash
mrscraper scraperAPI "https://books.toscrape.com/"
mrscraper scraperAPI "https://books.toscrape.com/" --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --no-html --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --markdown --screenshot --proxy-country us
mrscraper scraperAPI "https://books.toscrape.com/" --save page.html
```

The CLI sends a `GET` request to `https://api.mrscraper.com`. The target URL,
output flags, page options, and retry controls are all sent as query
parameters. The API token is sent as the `token` query parameter and in the
`x-api-token` header.

HTML is included by default. Requesting only HTML returns the page as a string
in `data`. Requesting Markdown or a screenshot returns an object in `data` with
an entry for each requested output, such as `html`, `markdown`, and
`screenshot` (base64-encoded). At least one of `--html`, `--markdown`, or
`--screenshot` must remain selected.

| Option | Default | Purpose |
| --- | --- | --- |
| `--html`, `--no-html` | included | Include or omit the page HTML |
| `--markdown` | off | Include the page as Markdown |
| `--screenshot` | off | Include a base64 screenshot; enables browser rendering |
| `--browser-rendering`, `--no-browser-rendering` | omitted; API default | Force or disable browser rendering; screenshots always render |
| `--super` | off | Real-device routing |
| `--geo-code <code>` | `US` | Geolocation |
| `--proxy-country <code>`, `--proxy <proxy>`, `--no-use-proxy` | API defaults | Proxy controls; custom proxies use `username:password@host:port` |
| `--wait-for-selector <selector>`, `--wait-until <event>` | omitted | Wait for a CSS selector or a page lifecycle event such as `domcontentloaded` |
| `--home-page` | off | Visit the site root before the target page (`warmStart`) |
| `--block-resources`, `--bypass-proxy` | off | Block images, CSS, and fonts, or enable proxy-bypass behavior |
| `--cookie-jar <settings>`, `--headers <json>` | omitted | Cookie-jar settings and target request headers as a JSON object |
| `--max-retries <n>`, `--token-cap <n>` | `3`, omitted | Nonnegative retry count and retry-token budget, including zero |
| `--timeout <seconds>` | `120` | Page timeout from 1 to 300 seconds; the HTTP deadline is 30 seconds longer |
| `--stream`, `--no-stream` | API default | Streaming preference; the CLI buffers streamed responses |
| `--discard-token-secret <secret>` | omitted | Value for the `x-discard-token-secret` header |
| `--save <path>` | omitted | Save `data` to a file: HTML as text, combined outputs as JSON |
| `--token <key>` | configured credential | Authentication override |

## Web Search

Searches the web to retrieve real-time results, including relevant website
URLs, titles, descriptions, and related questions based on a given query.

```bash
mrscraper webSearch "e-menessaptieka.lv linkedin" --country us --num-results 10
mrscraper webSearch "web scraping best practices"
```

The CLI sends this request:

```bash
curl --location 'https://api.mrscraper.com' \
--header 'x-api-token: {MRSCRAPER_API_TOKEN}' \
--header 'Content-Type: application/json' \
--data '{
    "action": "websearch",
    "query": "e-menessaptieka.lv linkedin",
    "country": "us",
    "numResults": 10
}'
```

`data` contains `success`, `message`, and `data`. Each item in `data.data` has
`rank`, `title`, `url`, `description`, and `source`.

| Option | Default | Purpose |
| --- | --- | --- |
| `<query>` | required | The search query |
| `--country <code>` | omitted | Country code for localized results, such as `us`; omitted to use the service default |
| `--num-results <n>` | `10` | Number of results, an integer from 10 to 100 |
| `--timeout <seconds>` | `600` | HTTP request deadline |
| `--token <key>` | configured credential | Authentication override |

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

## Output

CLI data commands print `{ status_code, data, headers }`. Account JSON places
the summary at `data.account`. Failed HTTP or network requests exit nonzero
and include `error`; a 401 response means the API token is missing or invalid.
Invalid arguments exit nonzero with a message on stderr. Progress uses stderr.
Sensitive response headers are removed.

## Programmatic use

The package exports the same three operations:

```js
import { scraperAPI, webSearch, account } from "@mrscraper/cli";

const token = process.env.MRSCRAPER_API_KEY || process.env.MRSCRAPER_API_TOKEN;
const html = await scraperAPI({ token, url: "https://books.toscrape.com/" });
const page = await scraperAPI({ token, url: "https://books.toscrape.com/", markdown: true, screenshot: true });
console.log(page.data.markdown);
const results = await webSearch({ token, query: "e-menessaptieka.lv linkedin", country: "us", numResults: 10 });
for (const item of results.data.data) console.log(item.rank, item.title, item.url);
const status = await account({ token, timeout: 30 });
console.log(status.data.token_remaining);
```

Programmatic calls require an explicit `token` and do not load saved CLI
credentials or `.env` files automatically. They return an error result for
HTTP or network failures and throw for invalid arguments. Programmatic account
results put the summary directly in `data`. CLI options use kebab-case flags;
programmatic options use camelCase, including `browserRendering`, `homePage`,
`waitForSelector`, `waitUntil`, `maxRetries`, `tokenCap`, and `numResults`.

## Migrating from 0.5.x

Version 0.6.0 returns to three public operations: `scraperAPI`, `webSearch`,
and `account`. The format-specific commands and package exports from 0.5.x
(`scraperHtml`, `scraperMarkdown`, `getScreenshot`, `scraperJson`,
`scraperMultiplePage`, `scraperSitemap`, `scrapeBrand`, `getBrand`, and their
snake-case aliases) are no longer public.

| 0.5.x | 0.6.0 |
| --- | --- |
| `mrscraper scraperHtml <url>` | `mrscraper scraperAPI <url>` |
| `mrscraper scraperMarkdown <url>` | `mrscraper scraperAPI <url> --no-html --markdown` |
| `mrscraper getScreenshot <url>` | `mrscraper scraperAPI <url> --no-html --screenshot` |
| `mrscraper webSearch <query> --region us` | `mrscraper webSearch <query> --country us` |
| `scraperMarkdown({ token, url })` | `scraperAPI({ token, url, html: false, markdown: true })` |
| `webSearch({ token, query, region: "us" })` | `webSearch({ token, query, country: "us" })` |

`scraperAPI` now sends a `GET` request with every option in the query string.
Screenshots are returned as base64 in a JSON object instead of a binary image.

`webSearch` now calls `https://api.mrscraper.com` with
`action: "websearch"` and accepts `--country` and `--num-results` (10–100).
The `--region`, `--language`, `--page`, `--format`, `--raw`, `--render-js`, and
`--client-timeout` flags are removed, as are the `raw`, `format`, `region`,
`language`, `page`, and `renderJs` programmatic options and the `url` input
alias. The `MRSCRAPER_SYNC_BASE_URL` setting, the `SYNC_SCRAPER_BASE_URL`
export, and the search-URL input parser are removed. `account` is unchanged.

## Publish to npm manually

This checkout prepares version **0.6.0**. Version **0.5.1** is the previous
release. Publishing is manual; pushing this branch does not publish to npm. From the repository root, validate and preview the package:

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
an already installed package through the Scraper API, Web Search, and account mock workflow.

### Manual real API testing

To test the CLI itself from this checkout with a real token:

```bash
export MRSCRAPER_API_TOKEN="YOUR_API_TOKEN"

node bin/mrscraper.js account --json
node bin/mrscraper.js scraperAPI "https://books.toscrape.com/"
node bin/mrscraper.js scraperAPI "https://books.toscrape.com/" --markdown --screenshot
node bin/mrscraper.js webSearch "e-menessaptieka.lv linkedin" --country us --num-results 10
```

The CLI also loads a project `.env` file or credentials saved by `login`.

Run one function from this checkout at a time with your own API token:

```bash
export MRSCRAPER_API_TOKEN="YOUR_API_TOKEN"

node scripts/manual-real.mjs account
node scripts/manual-real.mjs scraperAPI
node scripts/manual-real.mjs webSearch
```

`MRSCRAPER_API_KEY` is also supported and takes precedence if both are set.
The Scraper API test requests HTML and Markdown from `https://books.toscrape.com/`;
the search test requests 10 results for `books to scrape`. Override the input:

```bash
node scripts/manual-real.mjs scraperAPI "https://example.com/"
node scripts/manual-real.mjs webSearch "web scraping Indonesia"
node scripts/manual-real.mjs --help
```

Responses are printed as JSON and saved to `.mrscraper/manual/<operation>.json`,
including API failures. Repeating an operation replaces its previous output.
These artifacts are ignored by Git. Failed operations exit nonzero.
This script uses the live services. Page and search requests can consume your API quota.

## License

MIT — see [LICENSE](./LICENSE).
