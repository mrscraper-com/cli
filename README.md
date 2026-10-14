# @mrscraper/cli

![MrScraper](./assets/mrscraper.jpeg)

MrScraper CLI for three data operations: `scraperAPI`, `webSearch`, and `account`.
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
- [mrscraper-web-search](./skills/mrscraper-web-search/SKILL.md): discover pages through Google.
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

```bash
mrscraper scraperAPI "https://books.toscrape.com/" --markdown
mrscraper scraperAPI "https://books.toscrape.com/" --screenshot --super
mrscraper scraperAPI "https://books.toscrape.com/" --no-html --markdown --home-page
```

Sends `POST https://api.mrscraper.com` with the same request contract as the
Node and Python SDKs. The body contains `url`, `maxRetries`, and optional
`tokenCap`; page controls are query parameters. Authentication uses Bearer
and `x-api-token` headers, plus the API's `token` query parameter.

| Option | Default | Purpose |
| --- | --- | --- |
| `--html`, `--no-html` | HTML enabled | Include or omit HTML |
| `--markdown` | off | Include Markdown |
| `--screenshot` | off | Include a screenshot; forces browser rendering |
| `--browser-rendering`, `--no-browser-rendering` | automatic fallback | Set browser rendering explicitly |
| `--super` | off | Real-device routing, independent of rendering |
| `--geo-code <code>` | `US` | Geolocation |
| `--proxy-country <code>`, `--proxy <url>`, `--no-use-proxy` | API defaults | Proxy controls |
| `--wait-for-selector <selector>` | omitted | Wait for delayed content |
| `--home-page` | off | Visit the site root via `warmStart=true` |
| `--block-resources`, `--bypass-proxy` | off | Resource and proxy controls |
| `--cookie-jar <settings>` | omitted | Cookie-jar settings |
| `--headers <json>` | omitted | Headers forwarded to the target site |
| `--max-retries <n>` | `3` | Nonnegative retry count |
| `--token-cap <n>` | omitted | Nonnegative token budget, including zero |
| `--timeout <seconds>` | `120` | Page deadline from 1 to 300 seconds |
| `--stream`, `--no-stream` | API default | Explicit streaming preference |
| `--discard-token-secret <secret>` | omitted | Discard-token header |
| `--token <key>` | configured credential | Authentication override |

The HTTP transport allows 30 seconds beyond the page timeout. `data` may be
text or a structured API payload depending on requested formats; inspect the
returned value before assuming HTML is directly in `data`.

## Web search

```bash
mrscraper webSearch "web scraping best practices" --region us --language en
mrscraper webSearch "https://www.google.com/search?q=books&gl=id&hl=en&start=10"
mrscraper webSearch "books" --format html --render-js
```

Sends `POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync`.
The CLI requests parsed JSON by default. `--format html` requests HTML;
`--raw` is a shorthand for that format. `--region`, `--language`, and `--page`
override values extracted from Google URLs. `start=10` selects page 2.
`--render-js` enables dynamic search features. `--client-timeout` defaults
to 120 seconds and controls the local deadline without entering the API body.

## Account

```bash
mrscraper account
mrscraper account --json
mrscraper account --pretty --no-color
```

Sends `GET https://api.app.mrscraper.com/api/v1/subscription-accounts` with
Bearer and `x-api-token` authentication. The summary includes identity,
verification state, subscription status, token usage, token limit, remaining
tokens, usage percentage, rate limit, renewal settings, and subscription end
date. API keys and billing identifiers are excluded. Remaining tokens are
clamped to zero for over-quota accounts. `--timeout` defaults to 30 seconds.

Interactive terminals show a dashboard by default. Use `--json` for scripts
or `--pretty` to force the dashboard. Redirected output is JSON.

## Version 0.4.0 and migration

Data commands return `{ status_code, data, headers }`. Account JSON places the
summary at `data.account`. Failed HTTP or network requests exit nonzero and
include `error`; progress uses stderr. Sensitive response headers are removed.

Version 0.4.0 exposes `scraperAPI`, `webSearch`, and `account`.

The former `fetch`, `serp`, `status`, `scrape`, `rerun`, `results`, and `result`
commands have been removed. Replace page retrieval with `scraperAPI`, Google
search with `webSearch`, and account checks with `account`. The CLI no longer
provides saved AI extraction, manual workflows, reruns, stored results, or
domain analytics. Login, auth, init, and setup remain configuration commands.

The previous programmatic data helpers have also been removed. Import the
three operations from the package:

```js
import { scraperAPI, webSearch, account } from "@mrscraper/cli";

const token = process.env.MRSCRAPER_API_KEY;
const page = await scraperAPI({ token, url: "https://books.toscrape.com/", markdown: true });
const results = await webSearch({ token, query: "books", format: "json" });
const status = await account({ token, timeout: 30 });
console.log(status.data.token_remaining);
```

Programmatic account results put the summary directly in `data`. CLI page
options use kebab-case flags; programmatic options use camelCase, including
`browserRendering`, `homePage`, `maxRetries`, and `tokenCap`.

## Publish to npm manually

This checkout is prepared for `0.4.0`. After merging the branch, run:

```bash
npm test
npm pack --dry-run
npm publish --dry-run --access public
npm login
npm publish --access public
npm view @mrscraper/cli@0.4.0 version
```

Publishing is manual; pushing this branch does not publish to npm.

## Development

```bash
npm test
npm pack --dry-run
```

Tests use local HTTP mocks and require no API token. Endpoint overrides for
local testing are `MRSCRAPER_FETCH_BASE_URL`, `MRSCRAPER_SYNC_BASE_URL`, and
`MRSCRAPER_API_BASE_URL`. Run `node scripts/harness-smoke.mjs codex` to verify
an already installed package through the same three-operation mock workflow.

## License

MIT — see [LICENSE](./LICENSE).
