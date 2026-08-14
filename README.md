# @mrscraper/cli
![](./assets/mrscraper.jpeg)

Official npm package [**`@mrscraper/cli`**](https://www.npmjs.com/package/@mrscraper/cli) for the [MrScraper](https://app.mrscraper.com) CLI. It installs the `mrscraper` command so you can fetch rendered HTML, create AI scrapers, rerun jobs, and read stored results from the terminal by yourself and compatible for cli agent.

The CLI prints JSON to stdout. Use `mrscraper --help` and `mrscraper <command> --help` for the same information as in this document.

Example usage
```bash
mrscraper scrape "https://www.ebay.com/itm/266727555514" \
  --prompt "get name, price, features/description, images, seller, and shipping"
```

## Table of contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Installation](#installation)
- [Authentication](#authentication)
- [Global options](#global-options)
- [Command reference](#command-reference)
  - [`login`](#login)
  - [`init`](#init)
  - [`logout`](#logout)
  - [`scrape`](#scrape)
  - [`rerun`](#rerun)
  - [`results`](#results)
  - [`result`](#result)
  - [`serp`](#serp)
- [Environment variables](#environment-variables)
- [Typical workflow](#typical-workflow)
- [Programmatic use](#programmatic-use)
- [Publishing (maintainers)](#publishing-maintainers)
- [License](#license)

## Quick start
```bash
npm install -g @mrscraper/cli
mrscraper login
mrscraper scrape "https://www.ebay.com/itm/266727555514" \
  --prompt "get name, price, features/description, images, seller, and shipping"
```

## Requirements

- [Node.js](https://nodejs.org/) **18 or newer**
- A MrScraper API key from the [app](https://app.mrscraper.com)

## Installation

Install globally (recommended):

```bash
npm install -g @mrscraper/cli
mrscraper --help
```

Run without a global install:

```bash
npx --yes @mrscraper/cli --help
npx --yes @mrscraper/cli scrape "https://example.com/"
```

From a git checkout:

```bash
git clone https://github.com/mrscraper-com/cli.git
cd cli
npm install
node bin/mrscraper.js --help
# optional: npm link   # puts `mrscraper` on your PATH from this folder
```

## Authentication

The easiest way to log in is `mrscraper login` — it opens your browser at https://app.mrscraper.com/auth/login and saves the API key automatically. If the browser flow isn't available (headless, SSH, CI, timeout), it falls back to prompting you to paste a key from https://app.mrscraper.com/api-tokens.
Prefer storing the key on disk or in the environment instead of pasting it into chats.

| Method | What to do |
|--------|------------|
| Browser login | `mrscraper login` or `mrscraper init` |
| Paste a key | `mrscraper login --no-browser` |
| CI or scripts | `mrscraper login --api-key YOUR_KEY` |
| Shell | `export MRSCRAPER_API_KEY=YOUR_KEY` (also accepts `MRSCRAPER_API_TOKEN`) |
| Per command | Pass `--token YOUR_KEY` on any command that calls the API |

**Precedence:** `--token` wins over environment variables, then the saved credentials file from `login`, then nothing (commands that need a key will exit with an error).

**Credential file location**

`login` saves to `~/.mrscraper/auth.json` (all platforms, file mode 600). The JSON file contains `{"api_key": "..."}`.

For backward compatibility the CLI still reads the legacy location if `auth.json` does not exist:

| OS | Legacy file (read-only fallback) |
|----|-----------|
| macOS / Linux | `$XDG_CONFIG_HOME/mrscraper/credentials.json` if `XDG_CONFIG_HOME` is set, otherwise `~/.config/mrscraper/credentials.json` |
| Windows | `%LOCALAPPDATA%\mrscraper\credentials.json`, or `%APPDATA%\mrscraper\credentials.json` if `LOCALAPPDATA` is unset |

`logout` deletes both files.

The CLI loads a `.env` file from the **current working directory** (if present) via `dotenv`, so `MRSCRAPER_API_KEY` can live in project `.env` files.

### Browser login contract (web app)

`mrscraper login` starts a one-shot HTTP server on `127.0.0.1` with a random port and opens:

```
https://app.mrscraper.com/auth/login?cli_redirect=<urlencoded http://127.0.0.1:PORT/callback>&state=<32-char hex nonce>
```

After the user authenticates, the web app must redirect (GET) to:

```
http://127.0.0.1:PORT/callback?token=<API_TOKEN>&state=<same state>
```

- Both params **must be in the query string** — a `#fragment` never reaches the CLI's local server and looks like a missing token.
- If the user refuses: `http://127.0.0.1:PORT/callback?error=access_denied&state=<same state>`.
- The web app must echo `state` unchanged (the CLI rejects mismatches) and must validate that `cli_redirect` matches `^http://127\.0\.0\.1:\d{1,5}/callback$` before redirecting — never redirect a token to any other host.

Until the web app implements `cli_redirect`, the login page simply opens normally; the CLI times out after `--timeout` seconds (default 180) and falls back to the paste prompt.

## Global options

These apply to the root program (before a subcommand):

| Option | Description |
|--------|-------------|
| `-v`, `--version` | Print the CLI version and exit. |
| `-h`, `--help` | Print help and exit. |

Running `mrscraper` with no subcommand prints the same help.

## Command reference

### `login`

Log in via your browser and save the API key to the [credential file](#authentication). Opens https://app.mrscraper.com/auth/login and waits for the token on a local callback. Falls back to a paste prompt when the browser flow isn't available (no TTY, SSH session, no display on Linux, `--no-browser`, `MRSCRAPER_NO_BROWSER` set, or the callback times out). Received keys are verified against the API before saving (a network failure downgrades this to a warning).

If you're already logged in, `login` verifies the saved key and asks before replacing it (an invalid saved key skips the question and logs in again). Use `--force` to skip the confirmation; `--api-key` always overwrites.

| Option | Required | Description |
|--------|----------|-------------|
| `--api-key <key>` | No | Provide the key non-interactively (for CI or scripts); skips the browser entirely. |
| `--token <key>` | No | Deprecated alias for `--api-key` on this command only. |
| `--no-browser` | No | Skip the browser flow and paste an API key instead. |
| `--timeout <seconds>` | No | Seconds to wait for the browser callback (default 180). |
| `--force` | No | Log in again without asking, even if an API key is already saved. |

```bash
mrscraper login
mrscraper login --no-browser
mrscraper login --api-key "$MRSCRAPER_API_KEY"
```

---

### `init`

Same login flow and storage as `login`, but prints a short welcome line first. Useful for “first run” discovery in agents or docs.

| Option | Required | Description |
|--------|----------|-------------|
| `--api-key <key>` | No | Same as `login --api-key`. |
| `--no-browser` | No | Same as `login --no-browser`. |
| `--timeout <seconds>` | No | Same as `login --timeout`. |
| `--force` | No | Same as `login --force`. |

```bash
mrscraper init
mrscraper init --api-key "$MRSCRAPER_API_KEY"
```

---

### `logout`

Deletes the saved credential files (`~/.mrscraper/auth.json` and the legacy credentials file) if they exist. No options.

```bash
mrscraper logout
```

---

### `scrape`

**Argument**

| Argument | Required | Description |
|----------|----------|-------------|
| `<url>` | Yes | Page URL to fetch (HTML mode) or to seed an AI scraper (AI mode). |

**Modes**

1. **HTML only** — If you omit `--prompt`, `--agent`, and `--proxy-country`, the CLI calls the render API once and returns HTML in the response (synchronous for this process).
2. **AI scraper** — If you pass any of `--prompt`, `--agent`, or `--proxy-country`, the CLI creates an AI scraper on the platform (work continues asynchronously; use `results` / `result` to poll).

**Options**

| Option | Default | Applies to | Description |
|--------|---------|--------------|-------------|
| `-p`, `--prompt <text>` | (see below) | AI | Extraction instructions. If you omit it in AI mode with agent `general` (explicit or implied), the default text is: `Get all data as complete as possible`. |
| `-a`, `--agent <agent>` | — | AI | `general`, `listing`, or `map`. Omit entirely for HTML-only mode. If you only set `--proxy-country`, agent defaults to `general`. |
| `--proxy-country <code>` | — | AI | Proxy exit country for the request. Setting this alone enables AI mode with agent `general`. |
| `--token <key>` | — | Both | Override saved key / env for this invocation. |
| `--max-pages <n>` | See description | AI | **`listing`:** max pages (default **1** if omitted). **`map`:** max pages (default **50** if omitted). **`general`:** the CLI accepts this flag for consistency, but the create-scraper API body does **not** include `maxPages` for the general agent. |
| `--geo-code <code>` | `US` | HTML | ISO-style country code for the render cluster. |
| `--timeout <seconds>` | `120` | HTML | Maximum wait for the render request (seconds). |
| `--block-resources` | off | HTML | When set, block images, CSS, fonts, and similar resources in the render. |
| `--max-depth <n>` | `2` | AI (`map`) | Crawl depth for the map agent. |
| `--limit <n>` | `1000` | AI (`map`) | Maximum results for the map agent. |
| `--include-patterns <regex>` | `""` | AI (`map`) | Include URL patterns (regex). |
| `--exclude-patterns <regex>` | `""` | AI (`map`) | Exclude URL patterns (regex). |

```bash
mrscraper scrape "https://example.com/"
mrscraper scrape "https://example.com/" --geo-code US --timeout 120 --block-resources
mrscraper scrape "https://example.com/" --agent general --prompt "Extract all products"
mrscraper scrape "https://example.com/" --agent listing --prompt "Title, price, URL" --max-pages 5
mrscraper scrape "https://example.com/" --agent map --max-depth 2 --max-pages 50 --limit 1000
```

---

### `rerun`

**Argument**

| Argument | Required | Description |
|----------|----------|-------------|
| `<target>` | Yes | Single URL (default), or a comma- / newline-separated list of URLs when `--bulk` is set. |

**Options**

| Option | Required | Description |
|--------|----------|-------------|
| `--type <type>` | **Yes** | Must be `ai` or `manual`. `ai` uses AI rerun endpoints; `manual` uses manual scraper rerun endpoints. |
| `--bulk` | No | Parse `<target>` with commas and newlines and call the bulk rerun API. |
| `--scraper-id <uuid>` | Yes unless `--bulk` | Scraper id for a **single** URL rerun. |
| `--id <uuid>` | Yes if `--bulk` | Same scraper id as `--scraper-id`, required for bulk so agents can use a consistent `--id` flag. |
| `--token <key>` | No | Override saved key / env. |
| `--max-depth <n>` | No (default `2`) | Passed on **AI** single and bulk reruns (map-style fields). |
| `--max-pages <n>` | No (default `50`) | Same as above. |
| `--limit <n>` | No (default `1000`) | Same as above. |
| `--include-patterns <regex>` | No (default `""`) | Same as above. |
| `--exclude-patterns <regex>` | No (default `""`) | Same as above. |

Manual reruns ignore the map-style fields; they are only sent for `--type ai`.

```bash
mrscraper rerun "https://example.com/page" --type ai --scraper-id SCRAPER_UUID
mrscraper rerun "https://a.com,https://b.com" --bulk --type manual --id SCRAPER_UUID
```

---

### `results`

List stored result rows (synchronous read from the API). Useful after `scrape` / `rerun` to poll until rows reach a terminal status.

| Option | Default | Description |
|--------|---------|-------------|
| `--token <key>` | — | Override saved key / env. |
| `--sort-field <field>` | `updatedAt` | One of: `createdAt`, `updatedAt`, `id`, `type`, `url`, `status`, `error`, `tokenUsage`, `runtime`. |
| `--sort-order <order>` | `DESC` | `ASC` or `DESC`. |
| `--page-size <n>` | `10` | Page size. |
| `--page <n>` | `1` | 1-based page index. |
| `--search <q>` | — | Search filter. |
| `--date-range-column <col>` | — | Column used together with `--start-at` / `--end-at`. |
| `--start-at <iso>` | — | Inclusive range start (format accepted by the API). |
| `--end-at <iso>` | — | Inclusive range end (format accepted by the API). |

```bash
mrscraper results --page-size 20 --sort-field updatedAt --sort-order DESC
mrscraper results --search "example.com" --page 2
```

---

### `result`

Fetch a single result row by id (synchronous).

| Argument / option | Required | Description |
|-------------------|----------|-------------|
| `[resultIdArg]` | One of arg or `--id` | Result UUID as a positional argument. |
| `--id <uuid>` | One of arg or `--id` | Same UUID as the positional form; use whichever is easier in scripts. |
| `--token <key>` | No | Override saved key / env. |

```bash
mrscraper result RESULT_UUID
mrscraper result --id RESULT_UUID
```

---

### `serp`

Google SERP sync scrape — one POST to the sync API; the response is printed when the request completes (synchronous for this CLI call). Uses `Authorization: Bearer` with your API key (same key as other commands).

| Argument / option | Required | Description |
|-------------------|----------|-------------|
| `<url>` | Yes | Google search or SERP URL (e.g. `https://www.google.com/search?q=...`). |
| `--raw` | No | When set, request raw SERP payload (`raw: true` in the API body). |
| `--timeout <seconds>` | No (default `120`) | Request timeout in seconds. |
| `--token <key>` | No | Override saved key / env. |

```bash
mrscraper serp "https://www.google.com/search?q=iphone+17"
mrscraper serp "https://www.google.com/search?q=iphone+17" --raw
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `MRSCRAPER_API_KEY` | API key (preferred name). |
| `MRSCRAPER_API_TOKEN` | Accepted alias for the same key. |
| `MRSCRAPER_NO_BROWSER` | If set, `login`/`init` skip the browser flow and prompt for a pasted key. |

## Typical workflow

1. `mrscraper login` once per machine (or set env vars in CI).
2. `mrscraper scrape "<url>" --agent general` (or `listing` / `map` as needed).
3. Read **`scraper_id`** (or equivalent) from the printed JSON.
4. `mrscraper rerun "<url>" --type ai --scraper-id <id>` for the same scraper on another URL.
5. `mrscraper results` and `mrscraper result --id …` until status and payload look complete.

## Programmatic use

The package exports HTTP helpers and credential helpers for Node.js:

```js
import {
  VERSION,
  loadSavedApiKey,
  createAiScraperApi,
  fetchHtmlApi,
} from "@mrscraper/cli";
```

## Compliance & Legal Risk

> **WARNING**
> Scraping login-protected pages carries serious legal and compliance risks. Many websites explicitly prohibit automated access in their Terms of Service, and bypassing authentication to scrape content may expose you to legal action including lawsuits, account termination, and financial penalties. By proceeding on scraping login-protected pages, you confirm that you have read and understood the target website's Terms of Service, and you fully accept all legal, financial, and ethical responsibility for your actions.

## License

MIT — see [LICENSE](./LICENSE)
