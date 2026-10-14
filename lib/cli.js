import { stdin as input, stdout as output, stderr as errorOutput } from "node:process";
import prompts from "prompts";
import { Command, InvalidArgumentError } from "commander";
import dotenv from "dotenv";
import { VERSION } from "./version.js";
import { loadAuth, saveApiKey } from "./config-store.js";
import { authStatus, loginWithBrowser, logout as logoutAuth, runWithAuth } from "./auth.js";
import { scraperAPI, webSearch, account } from "./api.js";
import { renderStatusDashboard } from "./status.js";
import { runBootstrap } from "./bootstrap.js";
import { installMrscraperSkill, SUPPORTED_HARNESSES } from "./skills-installer.js";

dotenv.config();

const ROOT_HELP = `CLI tool for MrScraper (https://app.mrscraper.com) web scraping.

Auth: Run mrscraper login for browser sign-in, or set MRSCRAPER_API_KEY.
Override a command with an API key using --token.`;

const ROOT_EPILOG = `
Examples:
  mrscraper scraperAPI "https://books.toscrape.com/" --markdown
  mrscraper webSearch "python web scraping" --region id --language id
  mrscraper account

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

/** @param {string} label @param {number} [minimum] @param {number} [maximum] */
function integerParser(label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new InvalidArgumentError(
        maximum === Number.MAX_SAFE_INTEGER
          ? `${label} must be an integer >= ${minimum}`
          : `${label} must be an integer from ${minimum} to ${maximum}`,
      );
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

/** @param {string} value */
function headersParser(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError("headers must be a JSON object");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((item) => typeof item === "string")
  ) {
    throw new InvalidArgumentError("headers must be a JSON object of string values");
  }
  return parsed;
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

  program
    .command("scraperAPI")
    .description("Fetch page HTML, Markdown, or a screenshot.")
    .argument("<url>", "Page URL to fetch.")
    .option("--html", "Include HTML.", true)
    .option("--no-html", "Omit HTML.")
    .option("--markdown", "Include Markdown.", false)
    .option("--screenshot", "Include a screenshot and enable browser rendering.", false)
    .option("--browser-rendering", "Enable browser rendering.")
    .option("--no-browser-rendering", "Disable automatic browser rendering.")
    .option("--super", "Enable real-device routing.", false)
    .option("--no-use-proxy", "Disable proxy routing.")
    .option("--proxy <proxy>", "Custom proxy URL.")
    .option("--proxy-country <code>", "Proxy country code.")
    .option("--geo-code <code>", "Geolocation code.", "US")
    .option("--wait-for-selector <selector>", "Wait for a CSS selector.")
    .option("--home-page", "Visit the site root first (warmStart).", false)
    .option("--block-resources", "Block nonessential page resources.", false)
    .option("--bypass-proxy", "Bypass proxy for supported requests.", false)
    .option("--cookie-jar <settings>", "Cookie-jar settings.")
    .option("--headers <json>", "Headers forwarded to the target site as JSON.", headersParser)
    .option("--stream", "Enable streaming.")
    .option("--no-stream", "Disable streaming.")
    .option("--max-retries <n>", "Maximum retries.", integerParser("max retries", 0), 3)
    .option("--token-cap <n>", "Token budget.", integerParser("token cap", 0))
    .option("--timeout <seconds>", "Page timeout from 1 to 300 seconds.", integerParser("timeout", 1, 300), 120)
    .option("--discard-token-secret <secret>", "Discard-token secret header.")
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (url, options) => {
      const result = await runWithSpinner("Fetching page content…", () =>
        runWithAuth(options.token, (credential) =>
          scraperAPI({ ...options, token: credential, url }),
        ),
      );
      printResult(result);
    });

  program
    .command("webSearch")
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
      "--timeout <seconds>",
      "Local HTTP request deadline in seconds.",
      integerParser("timeout", 1),
      600,
    )
    .option(
      "--client-timeout <seconds>",
      "Compatibility alias for --timeout; excluded from the API body.",
      integerParser("client timeout", 1),
    )
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (queryOrUrl, options) => {
      const result = await runWithSpinner("Fetching Google SERP…", () =>
        runWithAuth(options.token, (credential) =>
          webSearch({
            token: credential,
            query: queryOrUrl,
            region: options.region ?? null,
            language: options.language ?? null,
            page: options.page ?? null,
            format: options.format,
            renderJs: Boolean(options.renderJs),
            raw: Boolean(options.raw),
            timeout: options.clientTimeout ?? options.timeout,
          }),
        ),
      );
      printResult(result);
    });

  program
    .command("account")
    .description("Check account identity, subscription, token quota, and rate limits.")
    .option("--json", "Print the account summary as JSON.")
    .option("--pretty", "Always render the account dashboard.")
    .option("--no-color", "Disable ANSI color in the dashboard.")
    .option("--timeout <seconds>", "HTTP request timeout.", integerParser("timeout", 1), 30)
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (options) => {
      if (options.json && options.pretty) {
        throw new Error("--json and --pretty cannot be used together");
      }
      const response = await runWithSpinner("Loading account status…", () =>
        runWithAuth(options.token, (credential) =>
          account({ token: credential, timeout: options.timeout }),
        ),
      );
      printStatusResult(
        isApiFailure(response) ? response : { ...response, data: { account: response.data } },
        options,
      );
    });

  await program.parseAsync(argv);
}
