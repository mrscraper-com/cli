"""Render the same README structure for the CLI, SDKs, and integrations."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workspace", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--repo",
        action="append",
        choices=["cli", "sdk-python", "sdk-node", "langchain-mrscraper", "mrscraper-mcp"],
        help="Render only this repository; repeat to select several (default: all five).",
    )
    args = parser.parse_args()
    root = args.workspace
    ref = json.loads((root / "cli/docs/service-reference.json").read_text())
    P = ref["parameters"]
    repos = ["cli", "sdk-python", "sdk-node", "langchain-mrscraper", "mrscraper-mcp"]
    titles = {
        "cli": "MrScraper CLI",
        "sdk-python": "MrScraper Python SDK",
        "sdk-node": "MrScraper Node SDK",
        "langchain-mrscraper": "MrScraper LangChain Tools",
        "mrscraper-mcp": "MrScraper MCP Server",
    }
    intro = {
        "cli": "Command-line access to the seven MrScraper services, with browser sign-in and optional agent skill setup.",
        "sdk-python": "An async Python client for the seven MrScraper services.",
        "sdk-node": "An async JavaScript and TypeScript SDK for the seven MrScraper services.",
        "langchain-mrscraper": "LangChain tools backed by the seven-service MrScraper Python SDK.",
        "mrscraper-mcp": "An MCP server exposing the seven MrScraper services through hosted HTTP or local stdio.",
    }

    def camel(s):
        return re.sub(r"-([a-z])", lambda m: m[1].upper(), s)

    def snake(s):
        return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()

    def public(repo, name):
        if repo == "cli":
            return name
        if repo == "sdk-python":
            return name.replace("-", "_")
        if repo == "langchain-mrscraper":
            return "mrscraper_" + name.replace("-", "_")
        return camel(name)

    def field(repo, key, service):
        name = P[key]["name"]
        if repo in ["sdk-python", "langchain-mrscraper"]:
            return snake(name)
        if repo == "cli":
            if name in ["url", "query"]:
                return "<" + name + ">"
            flag = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()
            if P[key]["type"] == "boolean" and P[key]["default"] in [None, True]:
                return "--" + flag + " / --no-" + flag
            return "--" + flag
        return name

    def dtype(repo, key):
        typ = P[key]["type"]
        if typ == "false | string":
            return {
                "sdk-python": "`False` or str",
                "langchain-mrscraper": "`False` or str",
                "cli": "string",
            }.get(repo, "`false` or string")
        types = {"integer": "int", "string": "str", "boolean": "bool"}
        result = (
            types.get(typ, typ)
            if repo in ["sdk-python", "langchain-mrscraper"]
            else (
                "number (integer)" if repo == "sdk-node" and typ == "integer" else typ
            )
        )
        if "enum" in P[key]:
            result += ": " + ", ".join("`" + x + "`" for x in P[key]["enum"])
        return result

    def default(repo, key, service):
        p = P[key]
        if p["required"]:
            return "Required"
        value = service["defaults"].get(p["name"], p["default"])
        if value is None:
            return (
                "`None` (omitted)"
                if repo in ["sdk-python", "langchain-mrscraper"]
                else "Omitted"
            )
        if repo in ["sdk-python", "langchain-mrscraper"] and isinstance(value, bool):
            return "`" + str(value) + "`"
        return "`" + json.dumps(value) + "`"

    def table(repo, service):
        if not service["parameters"]:
            return "This service takes no service parameters. Authentication is configured separately."
        lines = [
            "| Parameter | HTTP field | Type | Default | Description |",
            "| --- | --- | --- | --- | --- |",
        ]
        for key in service["parameters"]:
            p = P[key]
            lines.append(
                f"| `{field(repo, key, service)}` | `{p['name']}` | {dtype(repo, key)} | {default(repo, key, service)} | {p['description']} |"
            )
        return "\n".join(lines)

    cls = {
        "status": "MrScraperStatus",
        "scrape-html": "MrScraperScrapeHTML",
        "scrape-markdown": "MrScraperScrapeMarkdown",
        "get-screenshot": "MrScraperGetScreenshot",
        "scrape-brand": "MrScraperScrapeBrand",
        "scrape-json": "MrScraperScrapeJSON",
        "web-search": "MrScraperWebSearch",
    }
    samples = {
        "status": {},
        "scrape-html": {
            "url": "https://example.com",
            "browserRendering": True,
            "warmStart": True,
            "waitForSelector": "body",
            "timeout": 120,
            "maxRetries": 0,
        },
        "scrape-markdown": {
            "url": "https://example.com",
            "warmStart": True,
            "maxAge": 86400000,
        },
        "get-screenshot": {
            "url": "https://example.com",
            "screenshot": "top",
            "timeout": 120,
        },
        "scrape-brand": {"url": "https://example.com"},
        "scrape-json": {
            "url": "https://example.com",
            "prompt": 'Extract the first 2 items with title and price. Json Schema: {"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"string"}},"required":["title","price"]}}',
            "browserRendering": True,
        },
        "web-search": {
            "query": "site:example.com documentation",
            "country": "id",
            "numResults": 20,
        },
    }
    cli_examples = {
        "status": "mrscraper status",
        "scrape-html": "mrscraper scrape-html https://example.com --browser-rendering --warm-start \\\n  --wait-for-selector 'body' --timeout 120 --max-retries 0",
        "scrape-markdown": "mrscraper scrape-markdown https://example.com --warm-start --max-age 86400000",
        "get-screenshot": "mrscraper get-screenshot https://example.com --screenshot top --timeout 120",
        "scrape-brand": "mrscraper scrape-brand https://example.com",
        "scrape-json": """mrscraper scrape-json https://example.com --browser-rendering \\\n  --prompt 'Extract the first 2 items with title and price. Json Schema: {"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"string"}},"required":["title","price"]}}' """,
        "web-search": 'mrscraper web-search "site:example.com documentation" --country id --num-results 20',
    }

    def example(repo, service):
        name = service["name"]
        sample = dict(samples[name])
        method = public(repo, name)
        if repo == "cli":
            return "```bash\n" + cli_examples[name].strip() + "\n```"
        if repo == "mrscraper-mcp":
            return (
                "```json\n"
                + json.dumps({"name": method, "arguments": sample}, indent=2)
                + "\n```"
            )
        if repo == "langchain-mrscraper":
            sample = {snake(k): v for k, v in sample.items()}
            return (
                "```python\nimport json\nfrom langchain_mrscraper import "
                + cls[name]
                + "\n\nresult = json.loads("
                + cls[name]
                + "().invoke("
                + repr(sample)
                + '))\nprint(result["data"])\n```'
            )
        positional = sample.pop("query" if name == "web-search" else "url", None)
        if repo == "sdk-python":
            arguments = [] if positional is None else [repr(positional)]
            arguments += [snake(k) + "=" + repr(v) for k, v in sample.items()]
            call = "client." + method + "(" + ", ".join(arguments) + ")"
            return (
                "```python\nimport asyncio\nfrom mrscraper import MrScraper\n\nasync def main():\n    client = MrScraper()\n    result = await "
                + call
                + '\n    print(result["data"])\n\nasyncio.run(main())\n```'
            )
        arguments = [] if positional is None else [json.dumps(positional)]
        if sample:
            arguments.append(json.dumps(sample, indent=2))
        return (
            "```js\nimport { "
            + method
            + ' } from "@mrscraper/sdk";\n\nconst result = await '
            + method
            + "("
            + ", ".join(arguments)
            + ");\nconsole.log(result.data);\n```"
        )

    def response_example(repo, value):
        if repo == "mrscraper-mcp":
            value = {
                "content": [
                    {
                        "type": "text",
                        "text": "[Formatted JSON matching structuredContent]",
                    }
                ],
                "structuredContent": value,
            }
        return "```json\n" + json.dumps(value, indent=2) + "\n```"

    def response_blocks(repo, service):
        blocks = []
        if repo == "langchain-mrscraper":
            blocks.append("Decoded response after `json.loads(tool.invoke(...))`:")
        elif repo == "mrscraper-mcp":
            blocks.append(
                "MCP tool result; the API response envelope is in `structuredContent`:"
            )
        for item in service["response_examples"]:
            blocks.extend(
                ["**" + item["label"] + "**", response_example(repo, item["value"])]
            )
        return blocks

    install = {
        "cli": """Requires Node.js 20 or newer.

```bash
npm install -g @mrscraper/cli@latest
```

For the CLI and optional agent skill pack:

```bash
npx -y @mrscraper/cli@latest init --all
```

For automated setup, use `npx -y @mrscraper/cli@latest init --all --yes --skip-auth`, then run browser login explicitly when needed.""",
        "sdk-python": """Requires Python 3.9 or newer.

```bash
python -m pip install --upgrade mrscraper-sdk
```""",
        "sdk-node": """Requires Node.js 18 or newer. Examples use ES modules; save executable examples as `.mjs` files or set `"type": "module"` in your package.

```bash
npm install @mrscraper/sdk
```""",
        "langchain-mrscraper": """Requires Python 3.9 or newer, LangChain Core, and `mrscraper-sdk>=0.12.0,<0.13.0` with the seven-service interface documented here.

```bash
python -m pip install --upgrade langchain-mrscraper
```

To install this checkout with its published SDK dependency:

```bash
python -m pip install -e '.[test]'
```""",
        "mrscraper-mcp": """The hosted server requires an MCP client with Streamable HTTP support. Local execution requires Node.js 20 or newer.

Configure the hosted endpoint in your MCP client:

```json
{"mcpServers":{"mrscraper":{"url":"https://mcp.mrscraper.com/mcp"}}}
```

For local stdio, configure the client to start `npx -y @mrscraper/mcp@latest`. The full configuration is in [Integration features](#integration-features).""",
    }
    auth = {
        "cli": """```bash
mrscraper login
mrscraper auth status
```

Browser sign-in saves a dedicated API key in `~/.mrscraper/auth.json`. Keep `mrscraper login` running until browser approval completes. `--no-open` prints the sign-in URL. `--no-browser` is an explicit interactive API-key prompt.

For automation, set `MRSCRAPER_API_KEY`. `--token` overrides configured authentication for one service call; it is sent in headers, never in the request URL.

```bash
export MRSCRAPER_API_KEY="YOUR_TOKEN"
```""",
        "sdk-python": """```bash
export MRSCRAPER_API_TOKEN="YOUR_TOKEN"
```

Use `MrScraper()` to read the environment or `MrScraper(token="YOUR_TOKEN")` for an explicit credential. Precedence is a nonempty `token`, `MRSCRAPER_API_TOKEN`, then `MRSCRAPER_API_KEY`. Authentication belongs to the client, not individual service parameters.""",
        "sdk-node": """```bash
export MRSCRAPER_API_TOKEN="YOUR_TOKEN"
```

Each function accepts an optional `token: string` in its options. Precedence is a nonempty explicit token, `MRSCRAPER_API_TOKEN`, then `MRSCRAPER_API_KEY`. Credentials are sent in headers, never in the request URL.""",
        "langchain-mrscraper": """```bash
export MRSCRAPER_API_TOKEN="YOUR_TOKEN"
```

Pass `token=`, `mrscraper_api_key=`, or an existing `client=MrScraper(...)` when constructing a tool or toolkit. Otherwise, credentials come from `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. Authentication is configured outside tool inputs.""",
        "mrscraper-mcp": """The hosted server supports browser sign-in through OAuth 2.1. Approve `account:read` for status and `scrape:write` for scraping/search. Existing connections with only `scrape:read` must reconnect for scraping/search.

Clients without OAuth can send an API key as `Authorization: Bearer YOUR_TOKEN`. Local stdio reads `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. Tools do not accept tokens as arguments.

```json
{"mcpServers":{"mrscraper":{"url":"https://mcp.mrscraper.com/mcp","headers":{"Authorization":"Bearer YOUR_TOKEN"}}}}
```""",
    }
    errors = {
        "cli": """Failed API calls print a JSON envelope with `error` and set a nonzero exit code. HTTP status remains in `status_code`; network failures use `null`. Progress is written to stderr so stdout stays machine-readable. Invalid arguments fail before the request.

```bash
mrscraper scrape-html https://example.com > result.json
```""",
        "sdk-python": """Authentication failures raise `AuthenticationError`; other HTTP error statuses raise `APIError`; connection and timeout failures raise `NetworkError`. `APIError.status_code` contains the HTTP status when available. Invalid arguments raise `ValueError` or `TypeError` before the request.

```python
import asyncio
from mrscraper import MrScraper, APIError, AuthenticationError, NetworkError

async def main():
    try:
        await MrScraper().scrape_html("https://example.com")
    except AuthenticationError as error:
        print("Check authentication:", error)
    except APIError as error:
        print(error.status_code, error)
    except NetworkError as error:
        print("Request failed:", error)

asyncio.run(main())
```""",
        "sdk-node": """Authentication, HTTP, network, and timeout failures throw `MrScraperError`. Its `status` property is the HTTP status when available. Invalid arguments throw `TypeError` or `RangeError` before the request.

```js
import { scrapeHtml, MrScraperError } from "@mrscraper/sdk";

try {
  await scrapeHtml("https://example.com");
} catch (error) {
  if (error instanceof MrScraperError) console.error(error.status, error.message);
  else throw error;
}
```""",
        "langchain-mrscraper": """Invalid tool inputs raise Pydantic `ValidationError`. Authentication, HTTP, and transport failures propagate as the Python SDK's `AuthenticationError`, `APIError`, and `NetworkError`. `APIError.status_code` contains the HTTP status when available. Unsupported fields are rejected, including extra fields passed to status.""",
        "mrscraper-mcp": """HTTP and network failures set `isError: true` on the MCP tool result and include `error` in the response envelope. Network failures use `status_code: null`. Invalid inputs are rejected before upstream calls. Authentication and missing OAuth scopes are enforced by the HTTP transport before tool execution.""",
    }
    features = {
        "cli": [
            """The CLI also provides `init`, `login`, `auth status`, `logout`, and `setup skills`. Service options use kebab-case. `status --json` is accepted for compatibility; JSON is already the default.

Agent setup supports Claude Code, Cursor, Codex, Grok Build, Hermes Agent, OpenCode, OpenClaw, Pi, and Oh My Pi. `init --all` targets detected harnesses; `init --agent NAME` targets one. `--yes`, `--skip-auth`, and noninteractive input leave authentication for an explicit login.

```bash
mrscraper init --agent codex --yes --skip-auth
mrscraper init --all --yes --skip-auth --dry-run
mrscraper setup skills
mrscraper setup skills --agent hermes
```""",
            """Seven repository-hosted skills cover setup and account usage, plus one skill for each scraping and search command:

- [mrscraper](./skills/mrscraper/SKILL.md)
- [mrscraper-scrape-html](./skills/mrscraper-scrape-html/SKILL.md)
- [mrscraper-scrape-markdown](./skills/mrscraper-scrape-markdown/SKILL.md)
- [mrscraper-get-screenshot](./skills/mrscraper-get-screenshot/SKILL.md)
- [mrscraper-scrape-brand](./skills/mrscraper-scrape-brand/SKILL.md)
- [mrscraper-scrape-json](./skills/mrscraper-scrape-json/SKILL.md)
- [mrscraper-web-search](./skills/mrscraper-web-search/SKILL.md)

For programmatic JavaScript usage, import `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson`, `webSearch`, or `getSubscriptionAccountApi` from `@mrscraper/cli`. These low-level exports accept options objects that use the HTTP field names shown in each service table.

```js
import { scrapeHtml } from "@mrscraper/cli";
const result = await scrapeHtml({ token: process.env.MRSCRAPER_API_KEY, url: "https://example.com" });
console.log(result.data);
```

Hosted MCP setup is separate from the CLI and agent skill bootstrap. [MrScraper MCP](https://github.com/mrscraper-com/mrscraper-mcp) exposes `status`, `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson`, and `webSearch`. Native agent plugins are maintained separately for [ChatGPT and Codex](https://github.com/mrscraper-com/mrscraper-chatgpt-plugin) and [Claude](https://github.com/mrscraper-com/mrscraper-claude-plugin).""",
            """For missing credentials, run `mrscraper login` or configure `MRSCRAPER_API_KEY`. For slow pages, increase the page timeout up to 330 seconds. Brand and search have fixed 120-second transport deadlines. Use `--help` on a command to inspect its accepted options. Save large output with shell redirection.""",
        ],
        "sdk-python": [
            """All methods are coroutines and must be awaited. Examples use `asyncio.run(main())`; inside a notebook with an active event loop, use `await main()` instead. Keyword dictionaries can be unpacked with `**payload`. Optional controls set to `None` are omitted; explicit `False` and `0` are preserved.""",
            """Reuse an HTTP connection pool by passing `http_client=httpx.AsyncClient(...)`. You manage the supplied client's lifetime; the SDK creates and closes its own client when one is not supplied.

```python
import asyncio
import httpx
from mrscraper import MrScraper

async def main():
    async with httpx.AsyncClient() as http_client:
        client = MrScraper(http_client=http_client)
        print((await client.status())["data"])
        print((await client.scrape_markdown("https://example.com"))["data"])

asyncio.run(main())
```

The SDK applies each service's HTTP deadline even when a shared client is supplied.""",
            """Check token precedence when authentication fails. Use snake_case argument names rather than HTTP camelCase names. Page timeouts must be integers from 1 to 330; search does not accept a timeout argument. Inspect the raw API body before selecting nested fields.""",
        ],
        "sdk-node": [
            """Functions return promises and use camelCase options. Omit optional controls or use `undefined`; explicit `false` and `0` are preserved. TypeScript exports include `PageOptions`, `LoadingOptions`, `HtmlOptions`, `MarkdownOptions`, `ScreenshotOptions`, `JsonOptions`, `WebSearchOptions`, `StatusOptions`, and `MrScraperResponse<T>`.""",
            """Supply a generic response body type when you know the returned API shape:

```ts
import { scrapeJson } from "@mrscraper/sdk";
const result = await scrapeJson<{ data: { title: string } }>("https://example.com", { prompt: "Extract the page title" });
console.log(result.data.data.title);
```

Save screenshot JSON as an image when the API returns a base64 screenshot:

```js
import { getScreenshot } from "@mrscraper/sdk";
import { writeFile } from "node:fs/promises";
const result = await getScreenshot("https://example.com");
if (typeof result.data === "object" && typeof result.data?.screenshot === "string") {
  await writeFile("page.png", Buffer.from(result.data.screenshot, "base64"));
}
```""",
            """Check environment credentials when authentication fails. Use camelCase option names rather than snake_case. Page timeouts are integers from 1 to 330; status and search do not expose timeout options.""",
        ],
        "langchain-mrscraper": [
            """Each tool supports `invoke` and `ainvoke`. Synchronous calls are also supported inside notebooks with a running event loop. `MrScraperToolkit` and `load_mrscraper_tools` share one SDK client across their tools. Use `tool_names` to filter by exact tool names; an empty list returns none.""",
            """Use async invocation and select only the services your workflow needs:

```python
import asyncio
import json
from langchain_mrscraper import MrScraperToolkit

async def main():
    tools = MrScraperToolkit(tool_names=["mrscraper_scrape_markdown"]).get_tools()
    result = json.loads(await tools[0].ainvoke({"url": "https://example.com"}))
    print(result["data"])

asyncio.run(main())
```

Pass an existing `MrScraper(http_client=http_client)` as `client=` to reuse a connection pool. Manage the HTTP client's lifetime yourself. The public tool classes are `MrScraperStatus`, `MrScraperScrapeHTML`, `MrScraperScrapeMarkdown`, `MrScraperGetScreenshot`, `MrScraperScrapeBrand`, `MrScraperScrapeJSON`, and `MrScraperWebSearch`.""",
            """Install this checkout with `python -m pip install -e '.[test]'` to resolve the matching SDK dependency before testing. Tool inputs use snake_case and reject unsupported fields. Parse the JSON string returned by a tool with `json.loads`; raw API nesting remains inside `data`.""",
        ],
        "mrscraper-mcp": [
            """All client surfaces receive the same seven tools, input fields, and defaults. `/mcp/chatgpt` is an alternative route with the same service schemas and sign-in audience as `/mcp`. Tools authenticate through the connection.

For local stdio:

```json
{"mcpServers":{"mrscraper":{"command":"npx","args":["-y","@mrscraper/mcp@latest"],"env":{"MRSCRAPER_API_KEY":"YOUR_TOKEN"}}}}
```

For local HTTP, run `TRANSPORT=http npm start` after building; the default endpoint is `http://127.0.0.1:8000/mcp`. Docker runs can use `docker build -f docker/Dockerfile -t mrscraper-mcp .` and `docker run --rm -p 8000:8000 mrscraper-mcp`.""",
            """OAuth access tokens are verified against the configured issuer's JWKS and must include this resource in their audience. API keys are validated before tool execution. HTTP requests use their caller's credential; stdio reads server environment credentials. Metadata discovery is available at `/.well-known/oauth-protected-resource` and the `/mcp` path-suffixed variant.

All six scraping/search tools require `scrape:write`. Status requires `account:read`. HTML, Markdown, screenshot, and JSON tools advertise `readOnlyHint: false` because `saveResult` can persist data; status, brand, and search advertise `readOnlyHint: true`. All tools advertise `destructiveHint: false`; status has `openWorldHint: false` and scraping/search have `openWorldHint: true`.

Supported hosts can render self-contained search and account widgets. The account widget calculates its visual usage display locally from the raw tool result. Widget display does not change the raw status response.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `TRANSPORT` | `stdio` | Select `stdio` or `http`. |
| `HOST` | `127.0.0.1` | HTTP bind address; Docker uses `0.0.0.0`. |
| `PORT` | `8000` | HTTP listen port. |
| `MRSCRAPER_HTTP_AUTH` | `1` | Enable HTTP bearer verification. |
| `MRSCRAPER_OAUTH` | `1` | Accept OAuth access tokens. |
| `MRSCRAPER_MCP_PUBLIC_URL` | `https://mcp.mrscraper.com` | Public origin and token audience prefix. |
| `MRSCRAPER_OAUTH_ISSUER` | `https://api.app.mrscraper.com` | Authorization issuer. |
| `MRSCRAPER_OAUTH_JWKS_URL` | `<issuer>/.well-known/jwks.json` | Token verification keys. |
| `MRSCRAPER_ALLOWED_ORIGINS` | unset | Additional exact browser origins. |
| `MRSCRAPER_API_BASE_URL` | platform API | Account endpoint override. |
| `MRSCRAPER_FETCH_BASE_URL` | Scraper API | Scraping/search endpoint override. |
| `MRSCRAPER_LOG_HTTP_PAYLOAD` | off | Request-body diagnostics for trusted environments. |
| `MRSCRAPER_LOG_HTTP_PAYLOAD_MAX` | `8192` | Maximum diagnostic payload length. |

Trusted local origins, `claude.ai`, `chatgpt.com`, and configured exact origins are accepted. Service-to-service clients generally send no Origin header. Registry metadata is in `server.json`; `.github/workflows/publish-mcp-registry.yml` publishes matching immutable versions through GitHub OIDC.""",
            """For 401, reconnect through OAuth or check the bearer key. For `insufficient_scope`, reconnect and approve `scrape:write`. Ensure the hosted URL ends in `/mcp` because the audience is bound to that resource. For origin errors, configure the exact browser origin in `MRSCRAPER_ALLOWED_ORIGINS`. Start a new client session if cached tool schemas are stale.""",
        ],
    }
    migration = {
        "cli": "Version 0.8.0 matches the Scraper API reference. Removed options: `--super`, `--wait-until`, `--proxy-country`, `--proxy`, `--return-cookie`, `--save-result`, `--token-cap`, `scrape-markdown --html`, and the `get-screenshot` options `--no-html` and `--markdown`; `get-screenshot --screenshot` still defaults to `full` and now also accepts a `WIDTHxHEIGHT[-ZOOM]` viewport. Results are always saved to the dashboard (`saveResult=true`), and `tokenCap` is never sent. New options: `--max-age`, `--action` for HTML and Markdown, `--no-browser-rendering`, and `scrape-html --screenshot`; JSON extraction now accepts `--warm-start`, `--block-resources`, and `--wait-for-selector`. Changed defaults: Scrape JSON includes HTML (`--no-html` opts out), browser rendering is automatic unless set, `--geo-code` and `--country` are omitted unless set, and page timeouts accept up to 330 seconds. The `mrscraper-fetch` and `mrscraper-serp` skills are replaced by one skill per command: run `mrscraper setup skills` to install them, then `npx skills remove mrscraper-fetch mrscraper-serp --global --yes` to remove the old skills. Earlier releases replaced `account` with `status` and the combined `scraper-api` command with the six scraping and search commands.",
        "sdk-python": "Version 0.12.0 matches the Scraper API reference. Removed arguments: `super`, `wait_until`, `proxy_country`, `proxy`, `return_cookie`, `save_result`, `token_cap`, `scrape_markdown(html=...)`, and the `get_screenshot` arguments `html` and `markdown`; `get_screenshot(screenshot=...)` still defaults to `\"full\"` and now also accepts a `WIDTHxHEIGHT[-ZOOM]` viewport. Results are always saved to the dashboard (`saveResult=true`), and `tokenCap` is never sent. New arguments: `max_age`, `action` for HTML and Markdown, and `scrape_html(screenshot=...)`; `scrape_json` now accepts `warm_start`, `block_resources`, and `wait_for_selector`. Changed defaults: `scrape_json(html=True)`, `browser_rendering=None` (automatic), `geo_code=None` and `country=None` (omitted), and page timeouts up to 330 seconds. Earlier releases replaced `client.account()` with `client.status()` and `scraper_api` with the six scraping and search methods.",
        "sdk-node": "Version 6.1.0 matches the Scraper API reference. Removed options: `super`, `waitUntil`, `proxyCountry`, `proxy`, `returnCookie`, `saveResult`, `tokenCap`, `html` for `scrapeMarkdown`, and `html` and `markdown` for `getScreenshot`; its `screenshot` option still defaults to `\"full\"` and now also accepts a `WIDTHxHEIGHT[-ZOOM]` viewport. Results are always saved to the dashboard (`saveResult=true`), and `tokenCap` is never sent. New options: `maxAge`, `action` for HTML and Markdown, and `screenshot` for `scrapeHtml`; `scrapeJson` now accepts `warmStart`, `blockResources`, and `waitForSelector`. Changed defaults: `html: true` for `scrapeJson`, `browserRendering` omitted (automatic), `geoCode` and `country` omitted, and page timeouts up to 330 seconds. Earlier releases replaced `account()` with `status()` and the combined scraper call with the six scraping and search functions.",
        "langchain-mrscraper": "Version 0.7.0 matches the Scraper API reference and requires `mrscraper-sdk` 0.12. Removed inputs: `super`, `wait_until`, `proxy_country`, `proxy`, `return_cookie`, `save_result`, `token_cap`, `html` for `mrscraper_scrape_markdown`, and `html` and `markdown` for `mrscraper_get_screenshot`; its `screenshot` input still defaults to `\"full\"` and now also accepts a `WIDTHxHEIGHT[-ZOOM]` viewport. Results are always saved to the dashboard (`saveResult=true`), and `tokenCap` is never sent. New inputs: `max_age`, `action` for HTML and Markdown, and `screenshot` for `mrscraper_scrape_html`; `mrscraper_scrape_json` now accepts `warm_start`, `block_resources`, and `wait_for_selector`. Changed defaults: `html=True` for JSON extraction, `browser_rendering=None` (automatic), `geo_code=None` and `country=None` (omitted), and page timeouts up to 330 seconds. Tool inputs reject unsupported fields, so remove the old inputs from saved agent configurations.",
        "mrscraper-mcp": "Status keeps its tool name and returns the raw API body. Replace `scraperAPI` with `scrapeHtml`, `scrapeMarkdown`, or `getScreenshot`. Brand and JSON extraction are separate tools. Search uses `query`, `country`, and `numResults`. All clients now receive the full CLI-aligned input schema. Refresh cached tool definitions and approve `scrape:write` when upgrading older OAuth connections.",
    }
    auto = {
        "cli": "npm install\nnpm test\nnode bin/mrscraper.js --help",
        "sdk-python": "python -m pip install -e . pytest pytest-asyncio httpx ruff mypy\npython -m pytest -m 'not integration' -q\nruff check src tests\nmypy src",
        "sdk-node": "npm ci\nnpm test\nnpm run build",
        "langchain-mrscraper": "python -m pip install -e '.[dev]'\npython -m pytest -m 'not integration' -q\nruff check src tests\nmypy src",
        "mrscraper-mcp": "npm ci\nnpm test\nnpm run lint\nnpm run format:check\nnpm run build",
    }
    manual = {
        "cli": 'mrscraper status\nmrscraper scrape-html https://example.com\nmrscraper web-search "site:example.com documentation"',
        "sdk-python": 'python file.py status\npython file.py scrape-html --url https://example.com\npython file.py web-search --query "site:example.com documentation"',
        "sdk-node": 'npm run build\nnode file.js status\nnode file.js scrapeHtml https://example.com\nnode file.js webSearch "site:example.com documentation"',
        "langchain-mrscraper": "python manual_test.py status\npython manual_test.py scrape_html --url https://example.com\npython manual_check_tools.py --async --only mrscraper_web_search",
        "mrscraper-mcp": 'npm run test:manual -- status\nnpm run test:manual -- scrapeHtml --url https://example.com\nnpm run test:manual -- webSearch --query "site:example.com documentation"\nnpm run test:e2e',
    }
    differences = []
    formatter = root / "mrscraper-mcp/node_modules/.bin/prettier"

    def save(path, out, repo):
        if formatter.exists():
            out = subprocess.check_output(
                [str(formatter), "--stdin-filepath", str(path)], input=out, text=True
            )
        if not path.exists() or path.read_text() != out:
            differences.append(str(path.relative_to(root)))
            if not args.check:
                path.parent.mkdir(exist_ok=True, parents=True)
                path.write_text(out)

    for repo in args.repo or repos:
        logo = "./assets/mrscraper.jpeg" if repo == "cli" else "./mrscraper.jpeg"
        if repo == "mrscraper-mcp":
            logo = "./assets/mrscraper-banner.jpeg"
        blocks = [
            "# " + titles[repo],
            f"![MrScraper]({logo})",
            intro[repo],
            "## Overview",
            "Seven services share the same descriptions, parameter meanings, and defaults across the CLI, SDKs, and integrations. Names, types, authentication, and code examples follow each surface's conventions. See the [API Reference](https://docs.mrscraper.com/docs/api/overview).",
            "| Service | Public name | Description |",
            "| --- | --- | --- |",
        ]
        for service in ref["services"]:
            blocks.append(
                f"| [{service['title']}](#{service['title'].lower().replace(' ', '-')}) | `{public(repo, service['name'])}` | {service['description']} |"
            )
        blocks += [
            "## Installation",
            install[repo],
            "## Authentication",
            "Obtain an API key from [the MrScraper app](https://app.mrscraper.com/api-tokens). "
            + P["token"]["description"],
            auth[repo],
            "## Quickstart",
            example(repo, ref["services"][1]),
            "Examples use `example.com` as the sample target. Replace it for your use case. Live scraping and search calls consume account quota.",
            ref["response_examples_note"],
            "## Shared parameters",
            "### Page controls",
            "HTML, Markdown, screenshots, and JSON extraction share `url`, `timeout`, `waitForSelector`, `geoCode`, `maxAge`, and `maxRetries` (using the naming style shown below). Defaults are a 300-second timeout (up to 330) and a `maxAge` of 0 milliseconds, which always scrapes fresh; `maxAge` accepts up to 604800000 (7 days). `geoCode` and `maxRetries` are omitted unless set, so the API loads the page from the United States with no retry limit. Results are always saved to the dashboard (`saveResult=true`), and `tokenCap` is never sent. Exact types, defaults, and standard descriptions appear in each service table.",
            "### Loading controls",
            "HTML, Markdown, and JSON extraction also accept `browserRendering`, `warmStart`, and `blockResources`; HTML and Markdown also accept `action`. `browserRendering` is omitted unless set: the API loads the page without a browser first and switches to one if the request is blocked, while `true` always renders and `false` never does. Screenshots always render in a browser: Get screenshot sends `browserRendering=true`, and so does Scrape HTML whenever a screenshot is set.",
            "### Fixed request fields",
            "Each service adds its documented fixed fields automatically, so they are not service parameters: `html=true` and `markdown=false` for HTML (plus `browserRendering=true` when a screenshot is set), `markdown=true`, `html=false`, and `screenshot=false` for Markdown, `browserRendering=true`, `html=false`, and `markdown=false` for screenshots, `action=brand-scraping` and `bundle=none` for brand, `agent=general` for JSON extraction, and `action=websearch` for search. HTML, Markdown, screenshots, and JSON extraction also always send `saveResult=true`.",
            "## Service reference",
        ]
        for service in ref["services"]:
            blocks += [
                "### " + service["title"],
                "#### Description",
                service["description"],
                "#### Parameters",
                table(repo, service),
            ]
            if service["transport_timeout_seconds"] is not None:
                blocks += [
                    "The HTTP deadline is fixed at "
                    + str(service["transport_timeout_seconds"])
                    + " seconds. It is not a service parameter."
                ]
            if service["name"] == "scrape-html":
                blocks += [
                    "The request uses `html=true`, `markdown=false`, and `saveResult=true`. The screenshot is optional; setting one also sends `browserRendering=true`, because a screenshot needs a rendered page, and the response becomes JSON with `html` and `screenshot`."
                ]
            if service["name"] == "scrape-markdown":
                blocks += [
                    "The request uses `markdown=true`, `html=false`, `screenshot=false`, and `saveResult=true`."
                ]
            if service["name"] == "get-screenshot":
                blocks += [
                    "The request uses `browserRendering=true`, `html=false`, `markdown=false`, and `saveResult=true`; these are not service parameters. `screenshot` defaults to `full` and also accepts `top` or a `WIDTHxHEIGHT[-ZOOM]` viewport. The API still includes the page HTML in the response."
                ]
            if service["name"] == "scrape-brand":
                blocks += [
                    "The request uses `action=brand-scraping` and `bundle=none`; page controls are not accepted."
                ]
            if service["name"] == "web-search":
                blocks += [
                    "The request uses `action=websearch`. `country` is omitted unless set, so the API searches from the United States."
                ]
            if service["name"] == "scrape-json":
                blocks += [
                    "The request uses `agent=general`, `saveResult=true`, and GET. If the encoded URL exceeds 8,000 characters, it switches to POST with `url`, `prompt`, and `agent` in the body; page controls remain in the query."
                ]
            blocks += [
                "#### Example",
                example(repo, service),
                "#### Response",
                service["response"],
            ]
            blocks += response_blocks(repo, service)
        blocks += [
            "## Response format",
            "Successful services use an envelope containing `status_code`, `data`, and `headers`. The `data` field contains the API response body; its field names are not converted to the SDK's naming style. Status preserves the complete body without adding summary fields.",
            response_example(repo, ref["services"][1]["response_examples"][0]["value"]),
        ]
        extra = {
            "cli": "The CLI prints the envelope as JSON to stdout. It filters credential-bearing response headers and redacts known credential metadata in scraping/search JSON; status body fields are preserved.",
            "sdk-python": "Responses are Python dictionaries. JSON becomes Python values, text remains `str`, and binary remains `bytes`. Sensitive response headers are removed for status.",
            "sdk-node": "Responses are `MrScraperResponse<T>` objects. JSON becomes JavaScript values, text remains `string`, and binary remains `Buffer`. Sensitive response headers are removed for status.",
            "langchain-mrscraper": 'Tools return a JSON string; parse it with `json.loads`. Binary bodies are represented as `{ "encoding": "base64", "base64": "...", "size_bytes": 123 }`. The underlying SDK response envelope is preserved.',
            "mrscraper-mcp": "Tool results include matching text content and `structuredContent`. The envelope lives in `structuredContent`. Credential-bearing response headers are filtered, and scraping/search credential metadata is redacted. Status preserves every field in the response body.",
        }
        blocks += [
            extra[repo],
            "## Error handling",
            errors[repo],
            "## Integration features",
            "### Configuration",
            features[repo][0],
            "### Advanced usage",
            features[repo][1],
            "### Troubleshooting",
            features[repo][2],
            "## Migration",
            migration[repo],
            "## Development and testing",
            "### Automated checks",
            "The automated suite checks service behavior without production API calls.",
            "```bash\n" + auto[repo] + "\n```",
            "### Manual checks",
            "The following commands call the live API using your credentials and consume quota.",
            "```bash\n" + manual[repo] + "\n```",
            "## License",
            "MIT. See [LICENSE](./LICENSE).",
        ]
        out = "\n\n".join(blocks) + "\n"
        # Keep table rows contiguous while separating prose and headings.
        out = out.replace("|\n\n|", "|\n|")
        save(root / repo / "README.md", out, repo)
        if repo == "sdk-python":
            parts = [
                "# MrScraper API reference",
                "The public descriptions below use the same standard as the CLI, SDKs, and integrations. Authentication is sent in headers. Account status uses the platform subscription-accounts endpoint; scraping and search use the Scraper API.",
                ref["response_examples_note"],
            ]
            for service in ref["services"]:
                parts += [
                    "## " + service["title"],
                    service["description"],
                    table(repo, service),
                    service["response"],
                    *response_blocks(repo, service),
                ]
            parts += [
                "## Transport",
                "Status uses a fixed 600-second HTTP deadline. Brand and search use 120 seconds. Page services allow the page timeout plus 30 seconds. JSON extraction switches from GET to POST when the encoded URL exceeds 8,000 characters; url, prompt, and agent move to the JSON body.",
            ]
            save(root / repo / "docs/api-reference.md", "\n\n".join(parts) + "\n", repo)
        if repo == "langchain-mrscraper":
            for service in ref["services"]:
                parts = [
                    "---",
                    'title: "MrScraper ' + service["title"] + '"',
                    "---",
                    "",
                    service["description"],
                    "",
                    "Tool: `"
                    + public(repo, service["name"])
                    + "`. Supports `invoke` and `ainvoke`.",
                    "",
                    "## Parameters",
                    "",
                    table(repo, service),
                    "",
                    "## Example",
                    "",
                    example(repo, service),
                    "",
                    "## Response",
                    "",
                    service["response"],
                    "",
                    ref["response_examples_note"],
                    "",
                    *response_blocks(repo, service),
                    "",
                    "Returns a JSON string with status_code, data, and headers. See the [README](../../README.md) for authentication and integration details.",
                ]
                save(
                    root
                    / repo
                    / ("docs/tools/" + public(repo, service["name"]) + ".mdx"),
                    "\n".join(parts) + "\n",
                    repo,
                )

    if args.check and differences:
        raise SystemExit("READMEs differ from the standard: " + ", ".join(differences))
    print(
        ("Checked" if args.check else "Generated")
        + f" {len(args.repo or repos)} README(s) with the same section structure."
    )


if __name__ == "__main__":
    main()
