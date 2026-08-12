import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import {
  stdin as input,
  stdout as output,
  stderr as errorOutput,
} from "node:process";
import prompts from "prompts";
import { Command, InvalidArgumentError } from "commander";
import dotenv from "dotenv";
import { VERSION } from "./version.js";
import {
  loadSavedApiKey,
  saveApiKey,
  clearSavedApiKey,
} from "./config-store.js";
import {
  fetchWithUnblockerApi,
  createAiScraperApi,
  rerunAiScraperApi,
  bulkRerunAiScraperApi,
  rerunManualScraperApi,
  bulkRerunManualScraperApi,
  getAllResultsApi,
  getResultByIdApi,
  getSubscriptionAccountApi,
  getAnalyticStatusesApi,
  googleSerpSyncApi,
  parseBulkUrls,
} from "./api.js";
import { FETCH_FORMATS, formatFetchResult } from "./content.js";
import {
  formatApiDate,
  parseStatusDate,
  summarizeSubscriptionAccount,
} from "./status.js";
import { runBootstrap } from "./bootstrap.js";
import {
  installMrscraperSkill,
  SUPPORTED_HARNESSES,
} from "./skills-installer.js";

dotenv.config();

const DEFAULT_GENERAL_PROMPT = "Get all data as complete as possible";

const ROOT_HELP = `CLI tool for MrScraper (https://app.mrscraper.com) web scraping.

Auth: Run mrscraper login (or mrscraper init) once, or set MRSCRAPER_API_KEY.
Override per command with --token.`;

const ROOT_EPILOG = `
Examples:
  mrscraper fetch "https://books.toscrape.com/"
  mrscraper scrape "https://books.toscrape.com/" --prompt "Extract every book" -o .mrscraper/books.json
  mrscraper rerun "https://books.toscrape.com/" --type ai --scraper-id <uuid>
  mrscraper results --page-size 20 --sort-field updatedAt
  mrscraper result --id <uuid>
  mrscraper serp "iphone 17" --region id --language id
  mrscraper status

More: https://docs.mrscraper.com`;

/** @param {unknown} result */
export function isApiFailure(result) {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result.error ||
        (typeof result.status_code === "number" && result.status_code >= 400)),
  );
}

/** @param {unknown} result */
function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (isApiFailure(result)) process.exitCode = 1;
}

function stdinIsTTY() {
  try {
    return Boolean(input.isTTY);
  } catch {
    return false;
  }
}

/** @param {string | undefined} explicit */
function getToken(explicit) {
  const token =
    explicit ||
    process.env.MRSCRAPER_API_KEY ||
    process.env.MRSCRAPER_API_TOKEN ||
    loadSavedApiKey();
  if (!token) {
    throw new Error(
      "MrScraper API key is required. Run `mrscraper login`, set MRSCRAPER_API_KEY, or pass --token. Get a key at https://app.mrscraper.com/api-tokens.",
    );
  }
  return token;
}

/**
 * @param {string | undefined} apiKey
 * @param {string | undefined} tokenAlias
 */
async function promptApiKey(apiKey, tokenAlias) {
  const fromOption = (apiKey || tokenAlias)?.trim();
  if (fromOption) return fromOption;

  if (stdinIsTTY()) {
    const response = await prompts({
      type: "password",
      name: "key",
      message:
        "Get a MrScraper API key at https://app.mrscraper.com/api-tokens\nMrScraper API key",
    });
    if (response.key === undefined || response.key === null) {
      throw new Error("API key entry was cancelled");
    }
    return String(response.key).trim();
  }

  return await new Promise((resolve, reject) => {
    const readline = createInterface({ input, output });
    readline.question(
      "Get a MrScraper API key at https://app.mrscraper.com/api-tokens\nMrScraper API key: ",
      (answer) => {
        readline.close();
        resolve(answer.trim());
      },
    );
    readline.on("error", reject);
  });
}

/**
 * @param {string | undefined} apiKey
 * @param {string | undefined} tokenAlias
 */
async function persistApiKey(apiKey, tokenAlias) {
  const key = await promptApiKey(apiKey, tokenAlias);
  if (!key) throw new Error("API key is empty");
  const savedPath = saveApiKey(key);
  console.log(`Saved API key to ${savedPath}`);
}

/**
 * Progress is written only to stderr so stdout remains valid JSON.
 * @template T
 * @param {string | undefined} waitMessage
 * @param {() => Promise<T>} fn
 */
async function runWithSpinner(waitMessage, fn) {
  if (!waitMessage || !errorOutput.isTTY) return fn();
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  const timer = setInterval(() => {
    errorOutput.write(`\r${frames[index++ % frames.length]} ${waitMessage}`);
  }, 80);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    errorOutput.write("\r\x1b[K");
  }
}

const LISTING_NOTICE =
  "Notice: listing mode can take 150+ seconds even for one page and returns JSON only after all requested pages finish. Keep this process running; do not submit a duplicate request.";

/**
 * Keep long-running listing jobs visible without writing progress to stdout.
 * @template T
 * @param {number} maxPages
 * @param {() => Promise<T>} fn
 */
async function runListingWithProgress(maxPages, fn) {
  errorOutput.write(`${LISTING_NOTICE} max-pages=${maxPages}.\n`);

  if (errorOutput.isTTY) {
    return runWithSpinner("Creating listing scraper on MrScraper…", fn);
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - startedAt) / 1000),
    );
    errorOutput.write(
      `Listing still running... ${elapsedSeconds}s elapsed (max-pages=${maxPages}).\n`,
    );
  }, 30_000);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

/** @param {string} label @param {number} [minimum] */
function integerParser(label, minimum = 1) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum) {
      throw new InvalidArgumentError(`${label} must be an integer >= ${minimum}`);
    }
    return parsed;
  };
}

/** @param {string} label @param {string[]} choices */
function choiceParser(label, choices) {
  return (value) => {
    const normalized = String(value).toLowerCase();
    if (!choices.includes(normalized)) {
      throw new InvalidArgumentError(`${label} must be one of: ${choices.join(", ")}`);
    }
    return normalized;
  };
}

/** @param {string} schemaPath */
function readSchema(schemaPath) {
  try {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      throw new Error("schema root must be a JSON object");
    }
    return schema;
  } catch (exception) {
    const message = exception instanceof Error ? exception.message : String(exception);
    throw new Error(`Unable to read schema ${schemaPath}: ${message}`);
  }
}

/** @param {string | undefined} prompt @param {string | undefined} schemaPath */
export function buildExtractionMessage(prompt, schemaPath) {
  const trimmedPrompt = prompt?.trim();
  if (!schemaPath) return trimmedPrompt || DEFAULT_GENERAL_PROMPT;
  const schema = readSchema(schemaPath);
  const instruction = trimmedPrompt || "Extract data from the page";
  return `${instruction}\n\nReturn JSON matching this JSON Schema:\n${JSON.stringify(schema, null, 2)}`;
}

/** @param {unknown} response */
function unwrapApiData(response) {
  if (!response || typeof response !== "object") return response;
  const body = response.data;
  if (
    body &&
    typeof body === "object" &&
    Object.prototype.hasOwnProperty.call(body, "data")
  ) {
    return body.data;
  }
  return body;
}

/** @param {unknown} result */
function extractScrapePayload(result) {
  const body =
    result && typeof result === "object" && "data" in result
      ? result.data
      : result;
  const looksLikeRun = (value) =>
    Boolean(
      value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, "data") &&
        ["id", "scraperId", "status", "error", "type", "url"].some((key) =>
          Object.prototype.hasOwnProperty.call(value, key),
        ),
    );
  const run = looksLikeRun(body)
    ? body
    : body && typeof body === "object" && looksLikeRun(body.data)
      ? body.data
      : unwrapApiData(result);
  if (!run || typeof run !== "object") {
    throw new Error("MrScraper returned no extraction result");
  }

  if (run.error) {
    throw new Error(`MrScraper extraction failed: ${String(run.error)}`);
  }

  if (
    typeof run.status === "string" &&
    run.status.trim().toLowerCase() !== "finished"
  ) {
    throw new Error(`MrScraper extraction is not finished (status: ${run.status})`);
  }

  if (!Object.prototype.hasOwnProperty.call(run, "data") || run.data == null) {
    throw new Error("MrScraper returned no extracted data");
  }

  if (typeof run.data !== "string") return run.data;
  const value = run.data.trim();
  if (!value) throw new Error("MrScraper returned empty extracted data");

  try {
    return JSON.parse(value);
  } catch {
    return run.data;
  }
}

/** @param {unknown} result @param {string} outputPath */
function writeScrapePayload(result, outputPath) {
  const payload = extractScrapePayload(result);
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized === undefined) {
    throw new Error("MrScraper returned data that cannot be written as JSON");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${serialized}\n`, "utf8");
  errorOutput.write(`Wrote extracted JSON to ${outputPath}\n`);
}

/** @param {string} value */
function normalizeDomain(value) {
  const trimmed = value.trim();
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      .hostname;
  } catch {
    throw new Error(`Invalid domain: ${value}`);
  }
}

/** @param {string} url @param {Record<string, unknown>} options */
async function runFetch(url, options) {
  const result = await runWithSpinner("Fetching page content…", () =>
    fetchWithUnblockerApi({
      token: getToken(options.token),
      url,
      unblock: options.unblock || "auto",
      timeout: options.timeout ?? 30,
      geoCode: options.geo || options.geoCode || null,
      waitForSelector: options.waitFor || null,
      homePage: Boolean(options.homepage),
      blockResources: Boolean(options.blockResources),
      maxRetries: options.retries ?? 3,
      tokenCap: options.tokenCap ?? null,
    }),
  );
  printResult(
    formatFetchResult(result, {
      format: options.format || "markdown",
      url,
    }),
  );
}

function addFetchOptions(command) {
  return command
    .option(
      "--format <format>",
      "Output content format: markdown, html, or json.",
      choiceParser("format", FETCH_FORMATS),
      "markdown",
    )
    .option(
      "--unblock <mode>",
      "Unblock policy: auto, always, or never.",
      choiceParser("unblock", ["auto", "always", "never"]),
      "auto",
    )
    .option("--geo <code>", "ISO 3166-1 alpha-2 proxy country code.")
    .option("--wait-for <selector>", "Wait for a CSS selector (uses browser rendering).")
    .option("--homepage", "Visit the site's home page before the target URL.", false)
    .option("--block-resources", "Block non-essential browser resources.", false)
    .option(
      "--retries <n>",
      "Maximum API retry attempts after escalation.",
      integerParser("retries", 0),
      3,
    )
    .option("--token-cap <n>", "Maximum retry token usage.", integerParser("token cap", 1))
    .option(
      "--timeout <seconds>",
      "Maximum page-load time in seconds.",
      integerParser("timeout", 1),
      30,
    )
    .option("--token <key>", "Override saved/env API key.");
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
    .description("Store your API key in the local credentials file.")
    .option("--api-key <key>", "API key non-interactively (CI); otherwise prompt.")
    .option("--token <key>", "Deprecated alias for --api-key.")
    .action(async (options) => {
      await persistApiKey(options.apiKey, options.token);
    });

  program
    .command("init")
    .description("Install the CLI, authenticate, and add the skill pack to detected agents.")
    .option("--api-key <key>", "API key non-interactively; otherwise prompt.")
    .option("--all", "Install the skill pack for every detected agent harness (default).")
    .option(
      "--agent <name>",
      "Install the skill pack for one agent harness.",
      choiceParser("agent", SUPPORTED_HARNESSES),
    )
    .option("-y, --yes", "Accept defaults and do not prompt for a missing API key.")
    .option("--skip-install", "Do not install the CLI globally.")
    .option("--skip-auth", "Do not configure an API key.")
    .option("--skip-skills", "Do not install the agent skill pack.")
    .option("--dry-run", "Print bootstrap actions without changing the system.")
    .action(async (options) => {
      if (options.all && options.agent) {
        throw new Error("Use either --all or --agent, not both");
      }
      await runBootstrap(options, {
        hasCredentials: () =>
          Boolean(
            process.env.MRSCRAPER_API_KEY ||
              process.env.MRSCRAPER_API_TOKEN ||
              loadSavedApiKey(),
          ),
        authenticate: (apiKey) => persistApiKey(apiKey, undefined),
      });
    });

  const setup = program
    .command("setup")
    .description("Install or refresh optional MrScraper integrations.")
    .action(() => setup.help());

  setup
    .command("skills")
    .description("Install the MrScraper skill pack for detected agent harnesses.")
    .option("--all", "Install for every detected agent harness (default).")
    .option(
      "--agent <name>",
      "Install for one agent harness.",
      choiceParser("agent", SUPPORTED_HARNESSES),
    )
    .option("--dry-run", "Print installation commands without changing the system.")
    .action((options) => {
      if (options.all && options.agent) {
        throw new Error("Use either --all or --agent, not both");
      }
      installMrscraperSkill({
        agent: options.agent,
        dryRun: options.dryRun,
      });
    });

  program
    .command("logout")
    .description("Remove the saved API key file.")
    .action(() => {
      if (clearSavedApiKey()) console.log("Removed saved API key.");
      else console.log("No saved API key found.");
    });

  addFetchOptions(
    program
      .command("fetch")
      .description("Fetch page content without an extraction prompt.")
      .argument("<url>", "Page URL to fetch."),
  ).action(async (url, options) => {
    await runFetch(url, options);
  });

  program
    .command("scrape")
    .description(
      "Extract structured data using --prompt or --schema. Promptless use remains a deprecated fetch alias.",
    )
    .argument("<url>", "Page URL to scrape.")
    .option("-p, --prompt <text>", "Natural-language extraction instructions.")
    .option("--schema <path>", "Path to a JSON Schema included in the extraction prompt.")
    .option("-o, --output <path>", "Write only the extracted payload as JSON.")
    .option(
      "-a, --agent <agent>",
      "Existing AI mode: general, listing, or map.",
      choiceParser("agent", ["general", "listing", "map"]),
    )
    .option("--token <key>", "Override saved/env API key.")
    .option("--proxy-country <code>", "Proxy country supported by the AI scrape API.")
    .option("--max-pages <n>", "Listing/map maximum pages.", integerParser("max pages", 1))
    .option("--geo-code <code>", "Deprecated fetch-alias proxy region.", "US")
    .option("--timeout <seconds>", "Fetch-alias timeout.", integerParser("timeout", 1), 120)
    .option("--format <format>", "Fetch-alias output format.", choiceParser("format", FETCH_FORMATS))
    .option(
      "--unblock <mode>",
      "Fetch-alias unblock policy.",
      choiceParser("unblock", ["auto", "always", "never"]),
    )
    .option("--wait-for <selector>", "Fetch-alias CSS selector wait.")
    .option("--homepage", "Fetch-alias homepage navigation.", false)
    .option("--block-resources", "Fetch-alias resource blocking.", false)
    .option("--retries <n>", "Fetch-alias retry limit.", integerParser("retries", 0))
    .option("--token-cap <n>", "Fetch-alias retry token cap.", integerParser("token cap", 1))
    .option("--max-depth <n>", "Map crawl depth.", integerParser("max depth", 1), 2)
    .option("--limit <n>", "Map maximum results.", integerParser("limit", 1), 1000)
    .option("--include-patterns <regex>", "Map include URL regex.", "")
    .option("--exclude-patterns <regex>", "Map exclude URL regex.", "")
    .action(async (url, options, command) => {
      const useAi =
        options.prompt !== undefined ||
        options.schema !== undefined ||
        options.agent !== undefined ||
        options.proxyCountry !== undefined;

      if (!useAi) {
        if (options.output) {
          throw new Error(
            "--output saves structured extraction data and requires --prompt, --schema, or --agent",
          );
        }
        console.error(
          "Warning: promptless `mrscraper scrape` is deprecated; use `mrscraper fetch`.",
        );
        await runFetch(url, {
          ...options,
          format: options.format || "html",
          unblock: options.unblock || "auto",
        });
        return;
      }

      const fetchOnlyOptions = [
        "format",
        "unblock",
        "timeout",
        "geoCode",
        "waitFor",
        "homepage",
        "blockResources",
        "retries",
        "tokenCap",
      ].filter((name) => command.getOptionValueSource(name) === "cli");
      if (fetchOnlyOptions.length > 0) {
        throw new Error(
          `The AI scrape API does not support ${fetchOnlyOptions
            .map((name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
            .join(", ")}. Use fetch for these unblocker controls; AI scrape supports --proxy-country.`,
        );
      }

      const resolvedAgent = options.agent || "general";
      if (resolvedAgent === "map" && options.schema) {
        throw new Error("--schema is not supported by the map agent");
      }
      const pages =
        options.maxPages ?? (resolvedAgent === "listing" ? 1 : 50);
      const message = buildExtractionMessage(options.prompt, options.schema);

      const token = getToken(options.token);
      const createScraper = () =>
        createAiScraperApi({
          token,
          url,
          message,
          agent: resolvedAgent,
          proxyCountry: options.proxyCountry ?? null,
          maxDepth: options.maxDepth,
          maxPages: pages,
          limit: options.limit,
          includePatterns: options.includePatterns,
          excludePatterns: options.excludePatterns,
        });
      const result = await (resolvedAgent === "listing"
        ? runListingWithProgress(pages, createScraper)
        : runWithSpinner("Creating AI scraper on MrScraper…", createScraper));
      printResult(result);
      if (options.output && !isApiFailure(result)) {
        writeScrapePayload(result, options.output);
      }
    });

  program
    .command("rerun")
    .description("Re-run an existing AI or manual scraper; supports single and bulk URLs.")
    .argument("<target>", "One URL, or comma/newline-separated URLs with --bulk.")
    .requiredOption(
      "--type <type>",
      "ai or manual.",
      choiceParser("type", ["ai", "manual"]),
    )
    .option("--bulk", "Submit a bulk rerun.", false)
    .option("--scraper-id <uuid>", "Scraper ID for a single URL rerun.")
    .option("--id <uuid>", "Scraper ID for a bulk rerun.")
    .option("--token <key>", "Override saved/env API key.")
    .option("--max-depth <n>", "AI map crawl depth.", integerParser("max depth", 1), 2)
    .option("--max-pages <n>", "AI maximum pages.", integerParser("max pages", 1), 50)
    .option("--limit <n>", "AI maximum results.", integerParser("limit", 1), 1000)
    .option("--include-patterns <regex>", "AI include URL regex.", "")
    .option("--exclude-patterns <regex>", "AI exclude URL regex.", "")
    .action(async (target, options) => {
      const token = getToken(options.token);

      if (options.bulk) {
        if (!options.id) throw new Error("--id is required with --bulk");
        const urls = parseBulkUrls(target);
        if (urls.length < 1) throw new Error("No URLs found in the bulk target");
        const message =
          options.type === "ai"
            ? "Submitting bulk AI rerun…"
            : "Submitting bulk manual rerun…";
        const result = await runWithSpinner(message, () =>
          options.type === "ai"
            ? bulkRerunAiScraperApi({ token, scraperId: options.id, urls })
            : bulkRerunManualScraperApi({ token, scraperId: options.id, urls }),
        );
        printResult(result);
        return;
      }

      if (!options.scraperId) {
        throw new Error("--scraper-id is required unless --bulk is set");
      }
      const result = await runWithSpinner(
        options.type === "ai" ? "Submitting AI rerun…" : "Submitting manual rerun…",
        () =>
          options.type === "ai"
            ? rerunAiScraperApi({
                token,
                scraperId: options.scraperId,
                url: target.trim(),
                maxDepth: options.maxDepth,
                maxPages: options.maxPages,
                limit: options.limit,
                includePatterns: options.includePatterns,
                excludePatterns: options.excludePatterns,
              })
            : rerunManualScraperApi({
                token,
                scraperId: options.scraperId,
                url: target.trim(),
              }),
      );
      printResult(result);
    });

  program
    .command("serp")
    .description("Scrape Google results synchronously using a query or Google search URL.")
    .argument("<query-or-url>", "Search query or Google search URL.")
    .option("--region <code>", "Google result country code, such as us or id.")
    .option("--language <code>", "Google result language code, such as en or id.")
    .option("--page <n>", "Result page number.", integerParser("page", 1))
    .option(
      "--format <format>",
      "json for parsed results or html for the raw page.",
      choiceParser("format", ["json", "html"]),
      "json",
    )
    .option("--render-js", "Wait for JavaScript rendering, including AI Overview.", false)
    .option("--raw", "Deprecated alias for --format html.", false)
    .option("--timeout <seconds>", "Request timeout.", integerParser("timeout", 1), 120)
    .option("--token <key>", "Override saved/env API key.")
    .action(async (queryOrUrl, options) => {
      const result = await runWithSpinner("Fetching Google SERP…", () =>
        googleSerpSyncApi({
          token: getToken(options.token),
          query: queryOrUrl,
          region: options.region ?? null,
          language: options.language ?? null,
          page: options.page ?? null,
          format: options.format,
          renderJs: Boolean(options.renderJs),
          raw: Boolean(options.raw),
          timeout: options.timeout,
        }),
      );
      printResult(result);
    });

  program
    .command("status")
    .description("Show subscription, token usage, and optional domain analytics.")
    .option("--domain <domain>", "Add scrape analytics for this domain.")
    .option("--from <date-or-duration>", "Analytics start; ISO date or duration such as 24h.", "24h")
    .option("--to <date>", "Analytics end; ISO date or now.", "now")
    .option("--action <action>", "Optional analytics action filter.")
    .option("--api-token-name <name>", "Optional analytics API-token-name filter.")
    .option("--token <key>", "Override saved/env API key.")
    .action(async (options) => {
      const token = getToken(options.token);
      const accountResponse = await runWithSpinner("Loading account status…", () =>
        getSubscriptionAccountApi(token),
      );
      if (isApiFailure(accountResponse)) {
        printResult(accountResponse);
        return;
      }

      const account = unwrapApiData(accountResponse);
      const outputResult = {
        status_code: accountResponse.status_code,
        data: {
          account: summarizeSubscriptionAccount(account || {}),
        },
      };

      if (options.domain) {
        const domain = normalizeDomain(options.domain);
        const now = new Date();
        const end = parseStatusDate(options.to, now, "now");
        const start = parseStatusDate(options.from, end, "24h");
        if (start >= end) throw new Error("--from must be earlier than --to");
        const startDate = formatApiDate(start);
        const endDate = formatApiDate(end);
        const analyticsResponse = await runWithSpinner("Loading scrape analytics…", () =>
          getAnalyticStatusesApi({
            token,
            domain,
            startDate,
            endDate,
            // The live endpoint currently validates both documented-optional
            // filters as strings, so send empty strings when they are omitted.
            action: options.action ?? "",
            apiTokenName: options.apiTokenName ?? "",
          }),
        );
        if (isApiFailure(analyticsResponse)) {
          outputResult.error = "Account loaded, but analytics could not be loaded";
          outputResult.data.analytics = analyticsResponse;
        } else {
          outputResult.data.analytics = {
            domain,
            from: `${startDate} UTC`,
            to: `${endDate} UTC`,
            ...unwrapApiData(analyticsResponse),
          };
        }
      }

      printResult(outputResult);
    });

  program
    .command("results")
    .description("List scrape results with pagination and sorting.")
    .option("--token <key>", "Override saved/env API key.")
    .option("--sort-field <field>", "Sort field.", "updatedAt")
    .option(
      "--sort-order <order>",
      "ASC or DESC.",
      choiceParser("sort order", ["asc", "desc"]),
      "desc",
    )
    .option("--page-size <n>", "Page size.", integerParser("page size", 1), 10)
    .option("--page <n>", "1-based page index.", integerParser("page", 1), 1)
    .option("--search <query>", "Search filter.")
    .option("--date-range-column <column>", "Column used with start/end filters.")
    .option("--start-at <iso>", "Inclusive range start.")
    .option("--end-at <iso>", "Inclusive range end.")
    .action(async (options) => {
      const result = await runWithSpinner("Loading results…", () =>
        getAllResultsApi({
          token: getToken(options.token),
          sortField: options.sortField,
          sortOrder: options.sortOrder.toUpperCase(),
          pageSize: options.pageSize,
          page: options.page,
          search: options.search ?? null,
          dateRangeColumn: options.dateRangeColumn ?? null,
          startAt: options.startAt ?? null,
          endAt: options.endAt ?? null,
        }),
      );
      printResult(result);
    });

  program
    .command("result")
    .description("Fetch one result row by ID.")
    .argument("[result-id]", "Result UUID (optional with --id).")
    .option("--id <uuid>", "Result UUID.")
    .option("--token <key>", "Override saved/env API key.")
    .action(async (resultIdArgument, options) => {
      const resultId = options.id || resultIdArgument;
      if (!resultId) throw new Error("Pass a result ID or use --id");
      const result = await runWithSpinner("Loading result…", () =>
        getResultByIdApi(getToken(options.token), resultId),
      );
      printResult(result);
    });

  await program.parseAsync(argv);
}
