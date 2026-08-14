import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import prompts from "prompts";
import { Command } from "commander";
import dotenv from "dotenv";
import { VERSION } from "./version.js";
import {
  loadSavedApiKey,
  saveApiKey,
  clearSavedApiKey,
} from "./config-store.js";
import {
  fetchHtmlApi,
  createAiScraperApi,
  rerunAiScraperApi,
  bulkRerunAiScraperApi,
  rerunManualScraperApi,
  bulkRerunManualScraperApi,
  getAllResultsApi,
  getResultByIdApi,
  googleSerpSyncApi,
  parseBulkUrls,
  validateTokenApi,
  exchangeCliCodeApi,
} from "./api.js";
import { loginViaBrowser, BrowserLoginError } from "./browser-login.js";

dotenv.config();

const DEFAULT_GENERAL_PROMPT = "Get all data as complete as possible";

// const ROOT_HELP = `Command-line client for the MrScraper API (https://app.mrscraper.com).

// Auth: Run mrscraper login (or mrscraper init) once, or set MRSCRAPER_API_KEY.
// Override per command with --token.

// Sync vs async
// • scrape (HTML only): returns rendered HTML in the HTTP response — synchronous for this CLI call.
// • scrape (AI) and rerun: create or queue work on the platform — the API responds with job/scraper metadata; final rows are asynchronous. Use mrscraper results / mrscraper result --id … to poll until status is terminal.
// • results / result: read stored rows — synchronous.

// Flow: scrape --agent … returns a scraper_id in the JSON payload — pass it to rerun --scraper-id (or rerun --bulk --id …) for the same scraper configuration on new URLs.`;

const ROOT_HELP = `
CLI tool for MrScraper (https://app.mrscraper.com) web scraping.

Auth: Run mrscraper login (or mrscraper init) once, or set environment variable MRSCRAPER_API_KEY.
Override per command with --token.
`

const ROOT_EPILOG = `
Examples:
  mrscraper scrape "https://books.toscrape.com/"
  mrscraper scrape "https://books.toscrape.com/" --prompt "Get all data as complete as possible"
  mrscraper rerun "https://books.toscrape.com/" --type ai --scraper-id <uuid>
  mrscraper results --page-size 20 --sort-field updatedAt
  mrscraper result --id <uuid>
  mrscraper serp "https://www.google.com/search?q=iphone+17" --raw

  Common flow: scrape --agent … returns a scraper_id in the JSON payload — pass it to rerun --scraper-id (or rerun --bulk --id …) for the same scraper configuration on new URLs.

More: https://docs.mrscraper.com`;

/** @param {unknown} result */
function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function stdinIsTTY() {
  try {
    return Boolean(input.isTTY);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} explicit
 * @returns {string}
 */
function getToken(explicit) {
  const token =
    explicit ||
    process.env.MRSCRAPER_API_KEY ||
    process.env.MRSCRAPER_API_TOKEN ||
    loadSavedApiKey();
  if (!token) {
    console.error(
      "MrScraper API key is required. To get MrScraper API key, visit https://app.mrscraper.com/api-tokens\nRun `mrscraper login`, set MRSCRAPER_API_KEY, or pass --token.",
    );
    process.exit(1);
  }
  return token;
}

/**
 * @param {string | undefined} apiKey
 * @param {string | undefined} tokenAlias
 * @returns {Promise<string>}
 */
async function promptApiKey(apiKey, tokenAlias) {
  const fromOpt = (apiKey || tokenAlias)?.trim();
  if (fromOpt) return fromOpt;

  if (stdinIsTTY()) {
    const res = await prompts({
      type: "password",
      name: "key",
      message: "Get MrScraper API key here https://app.mrscraper.com/api-tokens\nMrScraper API key",
    });
    if (res.key === undefined || res.key === null) process.exit(1);
    return String(res.key).trim();
  }

  return await new Promise((resolve, reject) => {
    const rl = createInterface({ input, output });
    rl.question("Get MrScraper API key here https://app.mrscraper.com/api-tokens\nMrScraper API key: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    rl.on("error", reject);
  });
}

/**
 * @param {string} key
 * @returns {Promise<"valid" | "invalid" | "unknown">}
 */
async function verifyApiKey(key) {
  const res = await runWithSpinner("Verifying API key…", () => validateTokenApi(key));
  if (res.status_code === 401) return "invalid";
  if (res.status_code !== null && res.status_code >= 200 && res.status_code < 300) {
    return "valid";
  }
  return "unknown";
}

/**
 * Verify (best-effort) then persist a key.
 * @param {string} key
 * @returns {Promise<boolean>} false if the key failed validation (nothing saved)
 */
async function verifyAndSave(key) {
  const verdict = await verifyApiKey(key);
  if (verdict === "invalid") {
    console.error("The API key failed validation (401 Unauthorized). It was not saved.");
    return false;
  }
  if (verdict === "unknown") {
    console.error("Warning: could not verify the API key (network issue); saving anyway.");
  }
  const path = saveApiKey(key);
  console.log(`Saved API key to ${path}`);
  return true;
}

/** Prompt for a key (paste flow), verify, and save. Exits on failure. */
async function pasteLogin() {
  const key = await promptApiKey(undefined, undefined);
  if (!key) {
    console.error("API key is empty.");
    process.exit(1);
  }
  if (!(await verifyAndSave(key))) process.exit(1);
}

/**
 * @param {{ apiKey?: string, token?: string, browser?: boolean, timeout?: string }} opts
 * @returns {boolean}
 */
function shouldSkipBrowser(opts) {
  if (opts.browser === false) return true;
  if (process.env.MRSCRAPER_NO_BROWSER) return true;
  if (!stdinIsTTY()) return true;
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION) return true;
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    return true;
  }
  return false;
}

/** @param {{ apiKey?: string, token?: string, browser?: boolean, timeout?: string, force?: boolean }} opts */
async function loginAction(opts) {
  const explicit = (opts.apiKey || opts.token)?.trim();
  if (explicit) {
    if (!(await verifyAndSave(explicit))) process.exit(1);
    return;
  }

  const existing = loadSavedApiKey();
  if (existing && !opts.force) {
    const verdict = await verifyApiKey(existing);
    if (verdict === "invalid") {
      console.error("A saved API key exists but failed validation — logging in again.");
    } else if (stdinIsTTY()) {
      const message =
        verdict === "valid"
          ? "You're already logged in and the saved API key is valid. Log in again and replace it?"
          : "You're already logged in (could not verify the saved key right now). Log in again and replace it?";
      const res = await prompts({
        type: "confirm",
        name: "replace",
        message,
        initial: false,
      });
      if (!res.replace) {
        console.log("Keeping the existing login.");
        return;
      }
    } else {
      console.error("Note: an API key is already saved; it will be replaced.");
    }
  }

  if (shouldSkipBrowser(opts)) {
    await pasteLogin();
    return;
  }

  const timeoutMs = Math.max(1, Number(opts.timeout) || 180) * 1000;
  try {
    const result = await runWithSpinner(
      "Waiting for browser login… (Ctrl-C to cancel)",
      () =>
        loginViaBrowser({
          timeoutMs,
          log: (msg) => {
            // Clear the spinner line so log lines don't interleave with it.
            if (output.isTTY) output.write("\r\x1b[K");
            console.error(msg);
          },
        }),
    );
    let token = result.token;
    if (result.code) {
      const res = await runWithSpinner("Completing login…", () =>
        exchangeCliCodeApi({
          code: result.code,
          codeVerifier: result.codeVerifier,
        }),
      );
      token = res.data?.data?.token ?? res.data?.token ?? null;
      if (res.error || !token) {
        console.error(res.error || "The login code exchange returned no token.");
        token = null;
      }
    }
    if (token && (await verifyAndSave(token))) return;
  } catch (err) {
    if (err instanceof BrowserLoginError && err.code === "cancelled") {
      console.error("Login cancelled.");
      process.exit(130);
    }
    console.error(err instanceof Error ? err.message : String(err));
  }

  if (stdinIsTTY()) {
    console.error("Falling back to manual API key entry.");
    await pasteLogin();
  } else {
    console.error("Run `mrscraper login --api-key <key>` or set MRSCRAPER_API_KEY.");
    process.exit(1);
  }
}

/**
 * @template T
 * @param {string | undefined} waitMessage
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithSpinner(waitMessage, fn) {
  if (!waitMessage) return fn();
  if (!output.isTTY) {
    console.log(`\x1b[2m${waitMessage}\x1b[0m`);
    return fn();
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => {
    output.write(`\r${frames[i++ % frames.length]} ${waitMessage}`);
  }, 80);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    output.write("\r\x1b[K");
  }
}

export async function runCli(argv = process.argv) {
  const program = new Command();
  program
    .name("mrscraper")
    .description(ROOT_HELP)
    .version(VERSION, "-v, --version")
    .helpOption("-h, --help")
    .configureHelp({ sortSubcommands: true })
    .addHelpText("after", `\n${ROOT_EPILOG}`)
    .action(() => program.help());

  program
    .command("login")
    .description(
      "Log in via your browser (opens https://app.mrscraper.com/auth/login) and save the API key to ~/.mrscraper/auth.json. Falls back to pasting an API key (get one at https://app.mrscraper.com/api-tokens). Prefer this over pasting secrets into agent prompts — agents can run `mrscraper login` and you complete it in the browser or terminal.",
    )
    .option("--api-key <key>", "API key non-interactively (CI); skips the browser entirely.")
    .option("--token <key>", "Deprecated alias for --api-key for this command only.")
    .option("--no-browser", "Skip the browser flow and paste an API key instead.")
    .option("--timeout <seconds>", "Seconds to wait for the browser callback.", "180")
    .option("--force", "Log in again without asking, even if an API key is already saved.")
    .action(loginAction);

  program
    .command("init")
    .description(
      "Interactive setup — same login flow and credential storage as login. Use when an agent needs a discoverable first-run command.",
    )
    .option("--api-key <key>", "API key non-interactively; skips the browser entirely.")
    .option("--no-browser", "Skip the browser flow and paste an API key instead.")
    .option("--timeout <seconds>", "Seconds to wait for the browser callback.", "180")
    .option("--force", "Log in again without asking, even if an API key is already saved.")
    .action(async (opts) => {
      console.log("MrScraper CLI — store your API key for later commands.");
      await loginAction(opts);
    });

  program
    .command("logout")
    .description(
      "Remove saved credentials (~/.mrscraper/auth.json and the legacy credentials file).",
    )
    .action(() => {
      if (clearSavedApiKey()) console.log("Removed saved API key.");
      else console.log("No saved API key found.");
    });

  program
    .command("scrape")
    .description(
      "Two modes: (1) URL only — fast HTML fetch via the render API (sync HTTP). (2) With --prompt / --agent / --proxy-country — creates an AI scraper on the platform (async job; poll with results / result). Returns scraper_id in the response JSON for rerun. Synchronous.",
    )
    .argument("<url>", "Page URL to fetch or seed the AI scraper.")
    .option(
      "-p, --prompt <text>",
      `AI extraction instructions. Default for general: "${DEFAULT_GENERAL_PROMPT}".`,
    )
    .option(
      "-a, --agent <agent>",
      "Omit for HTML-only fetch. general | listing | map (map uses crawl fields below).",
      (v) => {
        if (!["general", "listing", "map"].includes(v)) {
          throw new Error("agent must be general, listing, or map");
        }
        return v;
      },
    )
    .option("--token <key>", "Override saved/env API key.")
    .option("--proxy-country <code>", "Proxy exit country (AI mode). Implies AI scraper with agent general if agent omitted.")
    .option("--max-pages <n>", "(listing: default 1. map: default 50.)", (v) => parseInt(v, 10))
    .option("--geo-code <code>", "(HTML mode) ISO country for the render cluster.", "US")
    .option("--timeout <seconds>", "(HTML mode) Max wait seconds.", "120")
    .option("--block-resources", "(HTML mode) Block images, CSS, fonts, etc.", false)
    .option("--max-depth <n>", "(map agent) Crawl depth.", "2")
    .option("--limit <n>", "(map agent) Max results.", "1000")
    .option("--include-patterns <regex>", "(map agent) Regex.", "")
    .option("--exclude-patterns <regex>", "(map agent) Regex.", "")
    .action(async (url, opts) => {
      const useAi =
        opts.prompt !== undefined || opts.agent !== undefined || opts.proxyCountry !== undefined;

      if (!useAi) {
        const result = await runWithSpinner("Fetching rendered HTML…", () =>
          fetchHtmlApi(
            getToken(opts.token),
            url,
            parseInt(String(opts.timeout), 10) || 120,
            opts.geoCode || "US",
            Boolean(opts.blockResources),
          ),
        );
        printResult(result);
        return;
      }

      /** @type {'general' | 'listing' | 'map'} */
      const resolvedAgent = opts.agent || "general";
      let pages;
      if (resolvedAgent === "listing") {
        pages = opts.maxPages !== undefined ? opts.maxPages : 1;
      } else if (resolvedAgent === "map") {
        pages = opts.maxPages !== undefined ? opts.maxPages : 50;
      } else {
        pages = 50;
      }

      const message =
        opts.prompt !== undefined ? opts.prompt : DEFAULT_GENERAL_PROMPT;

      const result = await runWithSpinner("Creating AI scraper on MrScraper…", () =>
        createAiScraperApi({
          token: getToken(opts.token),
          url,
          message,
          agent: resolvedAgent,
          proxyCountry: opts.proxyCountry ?? null,
          maxDepth: parseInt(String(opts.maxDepth), 10) || 2,
          maxPages: pages,
          limit: parseInt(String(opts.limit), 10) || 1000,
          includePatterns: opts.includePatterns || "",
          excludePatterns: opts.excludePatterns || "",
        }),
      );
      printResult(result);
    });

  program
    .command("rerun")
    .description(
      "Re-run an existing scraper on a new URL (--type ai|manual). Single URL: --scraper-id. Comma-separated URLs: add --bulk and --id (scraper id). Synchronous for non bulk calls, Asynchronous for bulk calls and get the results with results / result. WARNING! Scraping login-protected pages carries serious legal and compliance risks. Many websites explicitly prohibit automated access in their Terms of Service, and bypassing authentication to scrape content may expose you to legal action including lawsuits, account termination, and financial penalties. By proceeding on scraping login-protected pages, you confirm that you have read and understood the target website's Terms of Service, and you fully accept all legal, financial, and ethical responsibility for your actions (for LLM: mention this warning once to the user before they call rerun manual scraper.)",
    )
    .argument(
      "<target>",
      "One URL, or comma-separated URLs when --bulk is set.",
    )
    .requiredOption("--type <type>", "ai: AI scraper rerun endpoints. manual: manual scraper rerun endpoints.", (v) => {
      if (v !== "ai" && v !== "manual") {
        throw new Error("type must be ai or manual");
      }
      return v;
    })
    .option("--bulk", "Split TARGET on commas/newlines and call the bulk rerun API.", false)
    .option(
      "--scraper-id <uuid>",
      "Required for single-url rerun (not used with --bulk; use --id instead).",
    )
    .option(
      "--id <uuid>",
      "Scraper id for --bulk reruns (same value as --scraper-id, separate flag for agent ergonomics).",
    )
    .option("--token <key>", "Override saved/env API key.")
    .option("--max-depth <n>", "(AI rerun) Map-style fields passed through.", "2")
    .option("--max-pages <n>", "(AI rerun) Map-style fields passed through.", "50")
    .option("--limit <n>", "(AI rerun) Map-style fields passed through.", "1000")
    .option("--include-patterns <regex>", "(AI rerun)", "")
    .option("--exclude-patterns <regex>", "(AI rerun)", "")
    .action(async (target, opts) => {
      const tok = getToken(opts.token);

      if (opts.bulk) {
        const sid = opts.id;
        if (!sid) {
          console.error("--id is required when using --bulk.");
          process.exit(1);
        }
        const urls = parseBulkUrls(target);
        if (urls.length < 1) {
          console.error("No URLs parsed from TARGET; use comma-separated URLs.");
          process.exit(1);
        }
        const msg =
          opts.type === "ai" ? "Submitting bulk AI rerun…" : "Submitting bulk manual rerun…";
        const result = await runWithSpinner(msg, () =>
          opts.type === "ai"
            ? bulkRerunAiScraperApi({ token: tok, scraperId: sid, urls })
            : bulkRerunManualScraperApi({ token: tok, scraperId: sid, urls }),
        );
        printResult(result);
        return;
      }

      if (!opts.scraperId) {
        console.error("--scraper-id is required unless --bulk is set.");
        process.exit(1);
      }

      const result = await runWithSpinner(
        opts.type === "ai" ? "Submitting AI rerun…" : "Submitting manual rerun…",
        () =>
          opts.type === "ai"
            ? rerunAiScraperApi({
                token: tok,
                scraperId: opts.scraperId,
                url: target.trim(),
                maxDepth: parseInt(String(opts.maxDepth), 10) || 2,
                maxPages: parseInt(String(opts.maxPages), 10) || 50,
                limit: parseInt(String(opts.limit), 10) || 1000,
                includePatterns: opts.includePatterns || "",
                excludePatterns: opts.excludePatterns || "",
              })
            : rerunManualScraperApi({
                token: tok,
                scraperId: opts.scraperId,
                url: target.trim(),
              }),
      );
      printResult(result);
    });

  program
    .command("serp")
    .description(
      "Google SERP sync scrape — single POST to the sync API; response is returned in the HTTP body (synchronous).",
    )
    .argument("<url>", "Google search or SERP URL.")
    .option("--raw", "Return raw SERP payload.", false)
    .option("--timeout <seconds>", "Request timeout in seconds.", "120")
    .option("--token <key>", "Override saved/env API key.")
    .action(async (url, opts) => {
      const result = await runWithSpinner("Fetching Google SERP…", () =>
        googleSerpSyncApi({
          token: getToken(opts.token),
          url,
          raw: Boolean(opts.raw),
          timeout: parseInt(String(opts.timeout), 10) || 120,
        }),
      );
      printResult(result);
    });

  program
    .command("results")
    .description(
      "List scrape results with pagination and sorting. Use this after scrape / rerun to poll until items reach a terminal status. Synchronous.",
    )
    .option("--token <key>", "Override saved/env API key.")
    .option("--sort-field <field>", "Sort field.", "updatedAt")
    .option("--sort-order <order>", "ASC or DESC.", "DESC")
    .option("--page-size <n>", "Page size.", "10")
    .option("--page <n>", "1-based page index.", "1")
    .option("--search <q>", "Search filter.")
    .option("--date-range-column <col>", "Column used with start/end filters.")
    .option("--start-at <iso>", "Inclusive range start.")
    .option("--end-at <iso>", "Inclusive range end.")
    .action(async (opts) => {
      const result = await runWithSpinner("Loading results…", () =>
        getAllResultsApi({
          token: getToken(opts.token),
          sortField: opts.sortField,
          sortOrder: opts.sortOrder,
          pageSize: parseInt(String(opts.pageSize), 10) || 10,
          page: parseInt(String(opts.page), 10) || 1,
          search: opts.search ?? null,
          dateRangeColumn: opts.dateRangeColumn ?? null,
          startAt: opts.startAt ?? null,
          endAt: opts.endAt ?? null,
        }),
      );
      printResult(result);
    });

  program
    .command("result")
    .description("Fetch one result row by id. Synchronous.")
    .argument("[resultIdArg]", "Result UUID (optional if you use --id).")
    .option("--id <uuid>", "Result UUID from the platform or listings from `mrscraper results`.")
    .option("--token <key>", "Override saved/env API key.")
    .action(async (resultIdArg, opts) => {
      const rid = opts.id || resultIdArg;
      if (!rid) {
        console.error("Pass the result id as an argument or use --id.");
        process.exit(1);
      }
      const result = await runWithSpinner("Loading result…", () =>
        getResultByIdApi(getToken(opts.token), rid),
      );
      printResult(result);
    });

  await program.parseAsync(argv);
}
