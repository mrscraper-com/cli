import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  loadAuth,
  saveApiKey,
} from "./config-store.js";
import {
  authStatus,
  loginWithBrowser,
  logout as logoutAuth,
  runWithAuth,
} from "./auth.js";
import {
  fetchContentApi,
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
import {
  formatApiDate,
  parseStatusDate,
  renderStatusDashboard,
  summarizeSubscriptionAccount,
} from "./status.js";
import { runBootstrap } from "./bootstrap.js";
import {
  installMrscraperSkill,
  SUPPORTED_HARNESSES,
} from "./skills-installer.js";

dotenv.config();

const ROOT_HELP = `CLI tool for MrScraper (https://app.mrscraper.com) web scraping.

Auth: Run mrscraper login for browser sign-in, or set MRSCRAPER_API_KEY.
Override a command with an API key using --token.`;

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

function stdoutSupportsColor() {
  if ("NO_COLOR" in process.env || process.env.TERM === "dumb") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(output.isTTY);
}

/**
 * Keep status script-friendly while giving interactive terminals a dashboard.
 * @param {Record<string, unknown>} result
 * @param {{ json?: boolean; pretty?: boolean; color?: boolean }} options
 */
function printStatusResult(result, options) {
  const useDashboard = Boolean(options.pretty || (!options.json && output.isTTY));
  if (!useDashboard) {
    printResult(result);
    return;
  }

  console.log(
    renderStatusDashboard(result, {
      color: options.color !== false && stdoutSupportsColor(),
      width: output.columns,
    }),
  );
  if (isApiFailure(result)) process.exitCode = 1;
}

function stdinIsTTY() {
  try {
    return Boolean(input.isTTY);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} apiKey
 * @param {string | undefined} tokenAlias
 */
async function persistApiKey(apiKey, tokenAlias) {
  const fromOption = (apiKey || tokenAlias)?.trim();
  if (!fromOption) throw new Error("Pass a non-empty API key with --api-key");
  const savedPath = saveApiKey(fromOption);
  console.log(`Saved API key to ${savedPath}`);
}

async function promptAndPersistApiKey({ allowSkip = true } = {}) {
  console.log("Get a MrScraper API key at https://app.mrscraper.com/api-tokens");
  const response = await prompts({
    type: "password",
    name: "apiKey",
    message: allowSkip
      ? "MrScraper API key (leave blank to skip)"
      : "MrScraper API key",
  });
  const apiKey = String(response.apiKey || "").trim();
  if (!apiKey) {
    if (!allowSkip) throw new Error("MrScraper API key cannot be empty");
    console.log("No API key saved. Run `mrscraper login` when you are ready.");
    return;
  }
  await persistApiKey(apiKey, undefined);
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
 * @param {number | undefined} maxPages
 * @param {() => Promise<T>} fn
 */
async function runListingWithProgress(maxPages, fn) {
  const pageScope = maxPages === undefined ? "backend default" : String(maxPages);
  errorOutput.write(`${LISTING_NOTICE} max-pages=${pageScope}.\n`);

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
      `Listing still running... ${elapsedSeconds}s elapsed (max-pages=${pageScope}).\n`,
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
  if (!trimmedPrompt) throw new Error("--prompt is required for general and listing agents");
  if (!schemaPath) return trimmedPrompt;
  const schema = readSchema(schemaPath);
  return `${trimmedPrompt}\n\nBest-effort output guidance: return JSON matching this JSON Schema. The MrScraper API does not validate this schema:\n${JSON.stringify(schema, null, 2)}`;
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
  const body = result && typeof result === "object" ? result.data : null;
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    ["scraperId", "status", "type", "url"].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key),
    )
  ) {
    throw new Error("MrScraper response did not contain the documented data.data run object");
  }
  const run =
    body && typeof body === "object" && !Array.isArray(body)
      ? body.data
      : null;
  if (!run || typeof run !== "object") {
    throw new Error("MrScraper response did not contain the documented data.data run object");
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

  return run.data;
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
  if (options.waitForSelector && !options.browserRendering) {
    throw new Error("--wait-for-selector requires --browser-rendering");
  }
  const result = await runWithSpinner("Fetching page content…", () =>
    runWithAuth(options.token, (credential) =>
      fetchContentApi({
        token: credential,
        url,
        browserRendering: Boolean(options.browserRendering),
        timeout: options.timeout ?? 30,
        geoCode: options.geoCode ?? null,
        waitForSelector: options.waitForSelector ?? null,
        homePage: Boolean(options.homePage),
        blockResources: Boolean(options.blockResources),
        maxRetries: options.maxRetries ?? 3,
        tokenCap: options.tokenCap ?? null,
      }),
    ),
  );
  printResult(result);
}

function addFetchOptions(command) {
  return command
    .option(
      "--browser-rendering",
      "Send browserRendering=true to execute page JavaScript. Makes one API request.",
      false,
    )
    .option("--geo-code <code>", "Send the API's geoCode proxy-country query parameter.")
    .option(
      "--wait-for-selector <selector>",
      "Send waitForSelector; requires --browser-rendering.",
    )
    .option("--home-page", "Send homePage=true to visit the site root first.", false)
    .option("--block-resources", "Send blockResources=true.", false)
    .option(
      "--max-retries <n>",
      "Send the API's maxRetries value.",
      integerParser("max retries", 0),
      3,
    )
    .option("--token-cap <n>", "Send the API's tokenCap retry budget.", integerParser("token cap", 1))
    .option(
      "--timeout <seconds>",
      "Send the API page-load timeout; the CLI allows 30s more for transport.",
      integerParser("timeout", 1),
      30,
    )
    .option("--token <key>", "Override configured authentication with an API key.");
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
    .description("Sign in in your browser and save the provisioned API key.")
    .option("--api-key <key>", "Store this API key instead of opening a browser.")
    .option("--token <key>", "Deprecated alias for --api-key.")
    .option("--no-browser", "Prompt for an API key instead of browser sign-in.")
    .option("--no-open", "Print the browser sign-in URL without opening it.")
    .option(
      "--timeout <seconds>",
      "Seconds to wait for the browser callback.",
      integerParser("timeout", 1),
      180,
    )
    .action(async (options) => {
      if (options.apiKey !== undefined && options.token !== undefined) {
        throw new Error("Use either --api-key or --token, not both");
      }
      if (options.apiKey !== undefined || options.token !== undefined) {
        await persistApiKey(options.apiKey, options.token);
        return;
      }
      if (options.browser === false) {
        if (!stdinIsTTY()) {
          throw new Error(
            "Interactive API-key entry requires a terminal. Use --api-key or MRSCRAPER_API_KEY instead.",
          );
        }
        await promptAndPersistApiKey({ allowSkip: false });
        return;
      }
      await loginWithBrowser({
        noOpen: options.open === false,
        timeoutMs: options.timeout * 1000,
      });
    });

  program
    .command("init")
    .description("Install the CLI and skills for detected agents.")
    .option("--api-key <key>", "Store an API key non-interactively.")
    .option("--all", "Install skills for every detected agent harness (default).")
    .option(
      "--agent <name>",
      "Install skills for one agent harness.",
      choiceParser("agent", SUPPORTED_HARNESSES),
    )
    .option("-y, --yes", "Keep bootstrap non-interactive.")
    .option("--skip-install", "Do not install the CLI globally.")
    .option("--skip-auth", "Skip authentication and run login separately.")
    .option("--skip-skills", "Do not install the agent skill pack.")
    .option("--dry-run", "Print bootstrap actions without changing the system.")
    .action(async (options) => {
      if (options.all && options.agent) {
        throw new Error("Use either --all or --agent, not both");
      }
      await runBootstrap(
        { ...options, nonInteractive: !stdinIsTTY() },
        {
          hasCredentials: () =>
            Boolean(
              process.env.MRSCRAPER_API_KEY ||
              process.env.MRSCRAPER_API_TOKEN || loadAuth(),
            ),
          authenticate: (apiKey) =>
            apiKey
              ? persistApiKey(apiKey, undefined)
              : loginWithBrowser(),
        },
      );
    });

  const setup = program
    .command("setup")
    .description("Install or refresh the MrScraper skill pack.")
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

  const auth = program
    .command("auth")
    .description("Inspect local MrScraper authentication.")
    .action(() => auth.help());

  auth
    .command("status")
    .description("Show whether a local credential is configured; does not contact the API.")
    .option("--json", "Print machine-readable JSON.")
    .action((options) => {
      const status = authStatus();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      if (!status.credential_configured) {
        console.log(`No credential configured. Expected credentials at ${status.path}`);
      } else {
        console.log(
          status.source
            ? `API key configured through ${status.source}.`
            : `API key configured at ${status.path}`,
        );
      }
    });

  program
    .command("logout")
    .description("Remove locally saved MrScraper credentials.")
    .action(async () => {
      const result = await logoutAuth();
      if (result.removed) console.log("Removed saved MrScraper credentials.");
      else console.log("No saved MrScraper credentials found.");
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
    .description("Call the AI scraper endpoint for structured extraction or site mapping.")
    .argument("<url>", "Page URL to scrape.")
    .option(
      "-p, --prompt <text>",
      "Required extraction instructions for general/listing; rejected for map.",
    )
    .option(
      "--schema-prompt <path>",
      "CLI-only: append JSON Schema as best-effort prompt guidance; not API validation.",
    )
    .option(
      "-o, --output <path>",
      "CLI-only: write the documented response's data.data.data value as JSON.",
    )
    .option(
      "-a, --agent <agent>",
      "API agent mode: general, listing, or map.",
      choiceParser("agent", ["general", "listing", "map"]),
      "general",
    )
    .option("--token <key>", "Override configured authentication with an API key.")
    .option(
      "--proxy-country <code>",
      "Send proxyCountry for general/listing; rejected for map.",
    )
    .option(
      "--max-pages <n>",
      "Send maxPages for listing/map; omit it to use the backend default.",
      integerParser("max pages", 1),
    )
    .option(
      "--max-depth <n>",
      "Send maxDepth for map; omit it to use the backend default.",
      integerParser("max depth", 1),
    )
    .option(
      "--limit <n>",
      "Send limit for map; omit it to use the backend default.",
      integerParser("limit", 1),
    )
    .option("--include-patterns <regex>", "Send includePatterns for map.")
    .option("--exclude-patterns <regex>", "Send excludePatterns for map.")
    .action(async (url, options, command) => {
      const resolvedAgent = options.agent;
      const mapOnlyOptionNames = [
        "maxDepth",
        "limit",
        "includePatterns",
        "excludePatterns",
      ];

      if (resolvedAgent === "map") {
        if (command.getOptionValueSource("prompt") === "cli") {
          throw new Error("--prompt is not accepted by the map agent");
        }
        if (command.getOptionValueSource("schemaPrompt") === "cli") {
          throw new Error("--schema-prompt is not accepted by the map agent");
        }
        if (command.getOptionValueSource("proxyCountry") === "cli") {
          throw new Error("--proxy-country is not accepted by the map agent");
        }
      } else {
        if (!options.prompt?.trim()) {
          throw new Error("--prompt is required for general and listing agents");
        }
        const invalidMapOptions = mapOnlyOptionNames.filter(
          (name) => command.getOptionValueSource(name) === "cli",
        );
        if (invalidMapOptions.length > 0) {
          throw new Error(
            `${invalidMapOptions
              .map((name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
              .join(", ")} ${invalidMapOptions.length === 1 ? "is" : "are"} only accepted by the map agent`,
          );
        }
        if (
          resolvedAgent === "general" &&
          command.getOptionValueSource("maxPages") === "cli"
        ) {
          throw new Error("--max-pages is only accepted by listing and map agents");
        }
      }

      const pages = options.maxPages;
      const message =
        resolvedAgent === "map"
          ? undefined
          : buildExtractionMessage(options.prompt, options.schemaPrompt);

      const createScraper = (credential) =>
        createAiScraperApi({
          token: credential,
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
      const result = await runWithAuth(options.token, (credential) =>
        resolvedAgent === "listing"
          ? runListingWithProgress(pages, () => createScraper(credential))
          : runWithSpinner("Creating AI scraper on MrScraper…", () =>
              createScraper(credential),
            ),
      );
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
    .option("--token <key>", "Override configured authentication with an API key.")
    .option("--max-depth <n>", "AI map crawl depth.", integerParser("max depth", 1), 2)
    .option("--max-pages <n>", "AI maximum pages.", integerParser("max pages", 1), 50)
    .option("--limit <n>", "AI maximum results.", integerParser("limit", 1), 1000)
    .option("--include-patterns <regex>", "AI include URL regex.", "")
    .option("--exclude-patterns <regex>", "AI exclude URL regex.", "")
    .action(async (target, options, command) => {
      const aiOptionNames = [
        "maxDepth",
        "maxPages",
        "limit",
        "includePatterns",
        "excludePatterns",
      ];
      const explicitAiOptions = aiOptionNames.filter(
        (name) => command.getOptionValueSource(name) === "cli",
      );

      if (options.bulk) {
        if (!options.id) throw new Error("--id is required with --bulk");
        if (command.getOptionValueSource("scraperId") === "cli") {
          throw new Error("--scraper-id is only accepted for single reruns; use --id with --bulk");
        }
        if (explicitAiOptions.length > 0) {
          throw new Error(
            `${explicitAiOptions
              .map((name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
              .join(", ")} ${explicitAiOptions.length === 1 ? "is" : "are"} not accepted by bulk rerun endpoints`,
          );
        }
        const urls = parseBulkUrls(target);
        if (urls.length < 1) throw new Error("No URLs found in the bulk target");
        const message =
          options.type === "ai"
            ? "Submitting bulk AI rerun…"
            : "Submitting bulk manual rerun…";
        const result = await runWithSpinner(message, () =>
          runWithAuth(options.token, (credential) =>
            options.type === "ai"
              ? bulkRerunAiScraperApi({
                  token: credential,
                  scraperId: options.id,
                  urls,
                })
              : bulkRerunManualScraperApi({
                  token: credential,
                  scraperId: options.id,
                  urls,
                }),
          ),
        );
        printResult(result);
        return;
      }

      if (!options.scraperId) {
        throw new Error("--scraper-id is required unless --bulk is set");
      }
      if (command.getOptionValueSource("id") === "cli") {
        throw new Error("--id is only accepted with --bulk; use --scraper-id for a single rerun");
      }
      if (options.type === "manual" && explicitAiOptions.length > 0) {
        throw new Error(
          `${explicitAiOptions
            .map((name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
            .join(", ")} ${explicitAiOptions.length === 1 ? "is" : "are"} only accepted by single AI reruns`,
        );
      }
      const result = await runWithSpinner(
        options.type === "ai" ? "Submitting AI rerun…" : "Submitting manual rerun…",
        () =>
          runWithAuth(options.token, (credential) =>
            options.type === "ai"
              ? rerunAiScraperApi({
                  token: credential,
                  scraperId: options.scraperId,
                  url: target.trim(),
                  maxDepth: options.maxDepth,
                  maxPages: options.maxPages,
                  limit: options.limit,
                  includePatterns: options.includePatterns,
                  excludePatterns: options.excludePatterns,
                })
              : rerunManualScraperApi({
                  token: credential,
                  scraperId: options.scraperId,
                  url: target.trim(),
                }),
          ),
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
    .option(
      "--raw",
      "Deprecated CLI alias for --format html; the request still sends format=html.",
      false,
    )
    .option(
      "--client-timeout <seconds>",
      "CLI-only HTTP timeout; it is not included in the SERP request body.",
      integerParser("client timeout", 1),
      120,
    )
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (queryOrUrl, options) => {
      const result = await runWithSpinner("Fetching Google SERP…", () =>
        runWithAuth(options.token, (credential) =>
          googleSerpSyncApi({
            token: credential,
            query: queryOrUrl,
            region: options.region ?? null,
            language: options.language ?? null,
            page: options.page ?? null,
            format: options.format,
            renderJs: Boolean(options.renderJs),
            raw: Boolean(options.raw),
            timeout: options.clientTimeout,
          }),
        ),
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
    .option(
      "--json",
      "Print the CLI-composed status summary as JSON, not raw API responses.",
    )
    .option("--pretty", "Always render the account dashboard.")
    .option("--no-color", "Disable ANSI color in the dashboard.")
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (options) => {
      if (options.json && options.pretty) {
        throw new Error("--json and --pretty cannot be used together");
      }

      const accountResponse = await runWithSpinner("Loading account status…", () =>
        runWithAuth(options.token, (credential) =>
          getSubscriptionAccountApi(credential),
        ),
      );
      if (isApiFailure(accountResponse)) {
        printStatusResult(accountResponse, options);
        return;
      }

      const account = unwrapApiData(accountResponse);
      const outputResult = {
        kind: "mrscraper-cli-status-summary",
        source_endpoints: ["/subscription-accounts"],
        status_code: accountResponse.status_code,
        data: {
          account: summarizeSubscriptionAccount(account || {}),
        },
      };

      if (options.domain) {
        outputResult.source_endpoints.push("/analytic/statuses");
        const domain = normalizeDomain(options.domain);
        const now = new Date();
        const end = parseStatusDate(options.to, now, "now");
        const start = parseStatusDate(options.from, end, "24h");
        if (start >= end) throw new Error("--from must be earlier than --to");
        const startDate = formatApiDate(start);
        const endDate = formatApiDate(end);
        const analyticsResponse = await runWithSpinner("Loading scrape analytics…", () =>
          runWithAuth(options.token, (credential) =>
            getAnalyticStatusesApi({
              token: credential,
              domain,
              startDate,
              endDate,
              // The live endpoint currently validates both documented-optional
              // filters as strings, so send empty strings when they are omitted.
              action: options.action ?? "",
              apiTokenName: options.apiTokenName ?? "",
            }),
          ),
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

      printStatusResult(outputResult, options);
    });

  program
    .command("results")
    .description("List scrape results with pagination and sorting.")
    .option("--token <key>", "Override configured authentication with an API key.")
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
        runWithAuth(options.token, (credential) =>
          getAllResultsApi({
            token: credential,
            sortField: options.sortField,
            sortOrder: options.sortOrder.toUpperCase(),
            pageSize: options.pageSize,
            page: options.page,
            search: options.search ?? null,
            dateRangeColumn: options.dateRangeColumn ?? null,
            startAt: options.startAt ?? null,
            endAt: options.endAt ?? null,
          }),
        ),
      );
      printResult(result);
    });

  program
    .command("result")
    .description("Fetch one result row by ID.")
    .argument("[result-id]", "Result UUID (optional with --id).")
    .option("--id <uuid>", "Result UUID.")
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (resultIdArgument, options) => {
      const resultId = options.id || resultIdArgument;
      if (!resultId) throw new Error("Pass a result ID or use --id");
      const result = await runWithSpinner("Loading result…", () =>
        runWithAuth(options.token, (credential) =>
          getResultByIdApi(credential, resultId),
        ),
      );
      printResult(result);
    });

  await program.parseAsync(argv);
}
