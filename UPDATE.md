# Approved CLI Update Scope

> Implementation is limited to `mrscraper-cli`; no backend or related repository changes are included.
>
> Status: implemented and covered by automated tests in CLI version `0.3.0`.

## Implement Now

| Command | Change | Purpose |
| --- | --- | --- |
| `mrscraper fetch <url>` | Create | Retrieve page content without a prompt. Return Markdown by default, with HTML or JSON options. |
| `mrscraper scrape <url> --prompt <text>` | Modify | Extract requested structured data from a page. Support either `--prompt` or `--schema`. |
| `mrscraper serp <query-or-url>` | Modify | Keep Google result scraping and also accept a plain search query. |
| `mrscraper status` | Create | Show account status, quota, usage, and a short analytics summary. |

## Unblocker Integration

Add automatic unblocker handling to `fetch` and the promptless `scrape` compatibility path: direct request, browser rendering, optional regional proxy, then limited retries. Default to `--unblock auto`, with `always` and `never` overrides. Advanced options include region, selector waiting, homepage navigation, timeout, retry limit, and token cap.

The unblocker will be a shared internal capability, not a separate command.

The existing AI scrape API only supports `proxyCountry`; full unblocker controls cannot be added to structured AI scraping from this repository alone.

## Hold for a Later Phase

- New top-level `mrscraper agent` command.
- New `mrscraper manual create`, `manual run`, and `manual schedule` commands.

Existing agent and manual functionality will not be removed while these new command designs are on hold.

## Preserve Existing Commands

Keep the current commands and behavior available, including:

- `mrscraper rerun`, including AI, manual, and bulk reruns.
- `mrscraper results` and `mrscraper result`.
- `mrscraper login`, `init`, and `logout`.
- Existing `scrape --agent` support until the future agent redesign is approved.
- Existing Google SERP URL input alongside the new plain-query input.

During migration, promptless `mrscraper scrape <url>` will remain as a backward-compatible alias for `fetch`, with a deprecation notice.

## Command Distinction

```text
fetch  = return page content without a prompt
scrape = extract requested structured data using a prompt or schema
serp   = return Google search results
status = return account and usage health
```

## Live Validation

- Account status and domain analytics authenticated successfully.
- Markdown, HTML, JSON, automatic unblock, and forced-browser fetch paths passed.
- Plain-query and Google-URL SERP modes passed.
- Prompt-plus-schema extraction returned the expected typed JSON.
- Single result retrieval, result listing, single rerun, and two-URL bulk rerun passed.
- Live testing identified and fixed adaptive retry handling, analytics filter compatibility, and API-token leakage in stored curl responses.
