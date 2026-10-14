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
  getSubscriptionAccountApi,
  scraperApi,
  webSearchApi,
} from "./api.js";
import {
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
  mrscraper scraper-api "https://books.toscrape.com/"
  mrscraper scraper-api "https://books.toscrape.com/" --markdown --no-html
  mrscraper web-search "iphone 17" --region id --language id
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
    .command("scraper-api")
    .description(
      "Retrieve a page as HTML, Markdown, a screenshot, or a combination through the Scraper API.",
    )
    .argument("<url>", "Page URL to retrieve.")
    .option("--no-html", "Do not request HTML page content.")
    .option("--markdown", "Request Markdown page content.", false)
    .option(
      "--screenshot",
      "Capture a screenshot; always enables browser rendering.",
      false,
    )
    .option(
      "--browser-rendering",
      "Force browser rendering; omit both rendering flags for automatic browser fallback.",
    )
    .option("--no-browser-rendering", "Disable browser rendering.")
    .option(
      "--super",
      "Use real-device routing, independently of browser rendering.",
      false,
    )
    .option("--geo-code <code>", "Proxy geolocation country code.", "US")
    .option(
      "--proxy-country <code>",
      "Compatibility country option sent as proxyCountry.",
    )
    .option("--no-use-proxy", "Do not let the service use a configured proxy.")
    .option("--proxy <proxy>", "Custom proxy as username:password@host:port.")
    .option(
      "--wait-for-selector <selector>",
      "CSS selector to wait for before returning page content.",
    )
    .option(
      "--home-page",
      "Visit the site's root first; sent as warmStart=true.",
      false,
    )
    .option(
      "--block-resources",
      "Block images, CSS, and fonts during loading.",
      false,
    )
    .option("--bypass-proxy", "Enable the API's proxy-bypass behavior.", false)
    .option(
      "--cookie-jar <config>",
      "Cookie configuration, such as domain=example.com&country=us&max_used=100&max_age=50m.",
    )
    .option(
      "--headers <json>",
      'Target page request headers as a JSON object, such as {"Accept-Language":"en"}.',
      headersParser,
    )
    .option(
      "--max-retries <n>",
      "Maximum retries; 0 disables retries.",
      integerParser("max retries", 0),
      3,
    )
    .option(
      "--token-cap <n>",
      "Retry-token budget.",
      integerParser("token cap", 0),
    )
    .option(
      "--timeout <seconds>",
      "Page timeout from 1 to 300 seconds; the CLI allows 30 more for transport.",
      integerParser("timeout", 1, 300),
      120,
    )
    .option(
      "--stream",
      "Ask the API to stream; the CLI still prints one JSON response.",
    )
    .option(
      "--discard-token-secret <secret>",
      "Value for the x-discard-token-secret request header.",
    )
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (url, options) => {
      const result = await runWithSpinner("Retrieving page…", () =>
        runWithAuth(options.token, (credential) =>
          scraperApi({
            token: credential,
            url,
            html: options.html,
            markdown: Boolean(options.markdown),
            timeout: options.timeout,
            geoCode: options.geoCode,
            proxyCountry: options.proxyCountry ?? null,
            blockResources: Boolean(options.blockResources),
            browserRendering: options.browserRendering ?? null,
            superMode: Boolean(options.super),
            useProxy: options.useProxy,
            proxy: options.proxy ?? null,
            waitForSelector: options.waitForSelector ?? null,
            homePage: Boolean(options.homePage),
            screenshot: Boolean(options.screenshot),
            bypassProxy: Boolean(options.bypassProxy),
            cookieJar: options.cookieJar ?? null,
            headers: options.headers ?? null,
            maxRetries: options.maxRetries,
            tokenCap: options.tokenCap ?? null,
            stream: options.stream ? true : null,
            discardTokenSecret: options.discardTokenSecret ?? "",
          }),
        ),
      );
      printResult(result);
    });

  program
    .command("web-search")
    .description("Search Google from query text or a Google search URL.")
    .argument("<query-or-url>", "Search query or Google search URL.")
    .option(
      "--region <code>",
      "Country code, such as us or id; overrides gl from a Google search URL.",
    )
    .option(
      "--language <code>",
      "Language code, such as en or id; overrides hl from a Google search URL.",
    )
    .option(
      "--page <n>",
      "One-based result page; overrides start from a Google search URL.",
      integerParser("page", 1),
    )
    .option(
      "--format <format>",
      "json for parsed results or html for the result page.",
      choiceParser("format", ["json", "html"]),
      "json",
    )
    .option("--render-js", "Render JavaScript-dependent search features.", false)
    .option(
      "--timeout <seconds>",
      "Local request deadline in seconds.",
      integerParser("timeout", 1),
      600,
    )
    .option("--token <key>", "Override configured authentication with an API key.")
    .action(async (queryOrUrl, options) => {
      const result = await runWithSpinner("Searching Google…", () =>
        runWithAuth(options.token, (credential) =>
          webSearchApi({
            token: credential,
            url: queryOrUrl,
            raw: false,
            format: options.format,
            region: options.region ?? null,
            language: options.language ?? null,
            page: options.page ?? null,
            renderJs: Boolean(options.renderJs),
            timeout: options.timeout,
          }),
        ),
      );
      printResult(result);
    });

  program
    .command("status")
    .description("Show the account's subscription, token usage, and limits.")
    .option("--json", "Print the status summary as JSON.")
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
      printStatusResult(
        {
          kind: "mrscraper-cli-status-summary",
          source_endpoints: ["/subscription-accounts"],
          status_code: accountResponse.status_code,
          data: {
            account: summarizeSubscriptionAccount(account || {}),
          },
        },
        options,
      );
    });

  await program.parseAsync(argv);
}
