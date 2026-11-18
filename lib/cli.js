import {
  stdin as input,
  stdout as output,
  stderr as errorOutput,
} from "node:process";
import prompts from "prompts";
import { Command, InvalidArgumentError } from "commander";
import dotenv from "dotenv";
import { VERSION } from "./version.js";
import { loadAuth, saveApiKey } from "./config-store.js";
import {
  authStatus,
  loginWithBrowser,
  logout as logoutAuth,
  runWithAuth,
} from "./auth.js";
import {
  getSubscriptionAccountApi,
  scrapeHtml,
  scrapeMarkdown,
  getScreenshot,
  scrapeBrand,
  getBrand,
  scrapeJson,
  webSearch,
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
  mrscraper scrape-html "https://books.toscrape.com/"
  mrscraper scrape-markdown "https://books.toscrape.com/"
  mrscraper get-screenshot "https://example.com" --area full
  mrscraper scrape-brand "https://example.com"
  mrscraper scrape-json "https://books.toscrape.com/" --prompt "Extract titles and prices"
  mrscraper web-search "iphone 17" --country id
  mrscraper status

More: https://docs.mrscraper.com`;

/** @param {unknown} result */
export function isApiFailure(result) {
  const brandJob = result?.data?.data;
  return Boolean(
    result &&
      typeof result === "object" &&
      (result.error ||
        result.data?.success === false ||
        (typeof result.data?.error === "string" &&
          result.data.error.length > 0) ||
        (brandJob?.job_id &&
          (brandJob.status === "failed" ||
            (typeof brandJob.error === "string" &&
              brandJob.error.length > 0))) ||
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
  const useDashboard = Boolean(
    options.pretty || (!options.json && output.isTTY),
  );
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
  console.log(
    "Get a MrScraper API key at https://app.mrscraper.com/api-tokens",
  );
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
      throw new InvalidArgumentError(
        `${label} must be one of: ${choices.join(", ")}`,
      );
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

/** Shared documented page-loading controls; omitted values use upstream defaults. */
function addPageOptions(command) {
  return command
    .option("--browser-rendering", "Render the page in Chromium.")
    .option("--no-browser-rendering", "Disable browser rendering.")
    .option("--super", "Use real-device routing (API default).")
    .option("--no-super", "Use standard routing.")
    .option(
      "--wait-until <event>",
      "Navigation completion event.",
      choiceParser("wait until", [
        "domcontentloaded",
        "load",
        "networkidle0",
        "networkidle2",
      ]),
    )
    .option("--geo-code <code>", "Page geolocation country code.")
    .option("--proxy-country <code>", "Proxy country code.")
    .option("--proxy <url>", "Use a custom proxy.")
    .option("--block-resources", "Block images, fonts, and stylesheets.")
    .option("--wait-for-selector <selector>", "Wait for a CSS selector.")
    .option(
      "--return-cookie",
      "Include browser session cookies in the response.",
    )
    .option("--save-result", "Save the result to the dashboard (API default).")
    .option("--no-save-result", "Do not save the result to the dashboard.")
    .option(
      "--max-retries <n>",
      "Maximum retries; 0 disables retries.",
      integerParser("max retries", 0),
    )
    .option(
      "--token-cap <n>",
      "Maximum total tokens, including retries.",
      integerParser("token cap", 1),
    )
    .option(
      "--timeout <seconds>",
      "Page timeout; transport allows 30 additional seconds.",
      integerParser("timeout", 1, 300),
      300,
    )
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    );
}

function pageOptions(options) {
  return { ...options, superMode: options.super };
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
    .option(
      "--api-key <key>",
      "Store this API key instead of opening a browser.",
    )
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
    .option(
      "--all",
      "Install skills for every detected agent harness (default).",
    )
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
                process.env.MRSCRAPER_API_TOKEN ||
                loadAuth(),
            ),
          authenticate: (apiKey) =>
            apiKey ? persistApiKey(apiKey, undefined) : loginWithBrowser(),
        },
      );
    });

  const setup = program
    .command("setup")
    .description("Install or refresh the MrScraper skill pack.")
    .action(() => setup.help());

  setup
    .command("skills")
    .description(
      "Install the MrScraper skill pack for detected agent harnesses.",
    )
    .option("--all", "Install for every detected agent harness (default).")
    .option(
      "--agent <name>",
      "Install for one agent harness.",
      choiceParser("agent", SUPPORTED_HARNESSES),
    )
    .option(
      "--dry-run",
      "Print installation commands without changing the system.",
    )
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
    .description(
      "Show whether a local credential is configured; does not contact the API.",
    )
    .option("--json", "Print machine-readable JSON.")
    .action((options) => {
      const status = authStatus();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      if (!status.credential_configured) {
        console.log(
          `No credential configured. Expected credentials at ${status.path}`,
        );
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

  for (const [name, description, call] of [
    ["scrape-html", "Retrieve the raw HTML of a page.", scrapeHtml],
    ["scrape-markdown", "Retrieve clean Markdown from a page.", scrapeMarkdown],
    [
      "get-screenshot",
      "Capture a full-page or viewport screenshot.",
      getScreenshot,
    ],
    [
      "scrape-json",
      "Extract structured JSON using a natural-language prompt.",
      scrapeJson,
    ],
  ]) {
    const command = addPageOptions(
      program
        .command(name)
        .description(description)
        .argument("<url>", "Absolute HTTP or HTTPS page URL."),
    );
    if (name === "get-screenshot") {
      command
        .option(
          "--area <area>",
          "Capture full page or top viewport.",
          choiceParser("area", ["full", "top"]),
          "full",
        )
        .option("--no-html", "Exclude page HTML.")
        .option("--markdown", "Also include Markdown.");
    }
    if (name === "scrape-json") {
      command
        .option(
          "--prompt <text>",
          "Describe the JSON to extract; append Json Schema: to specify a schema.",
        )
        .option("--no-html", "Exclude page HTML.")
        .option("--screenshot", "Also include a screenshot.");
    }
    command.action(async (url, options) => {
      if (name === "get-screenshot" && options.browserRendering === false) {
        throw new Error("get-screenshot requires browser rendering");
      }
      const result = await runWithSpinner("Retrieving page…", () =>
        runWithAuth(options.token, (credential) =>
          call({ ...pageOptions(options), token: credential, url }),
        ),
      );
      printResult(result);
    });
  }

  program
    .command("scrape-brand")
    .description(
      "Scrape a website brand, or retrieve an existing job with --job-id.",
    )
    .argument("[url]", "Absolute HTTP or HTTPS page URL to scrape.")
    .option(
      "--bundle <mode>",
      "Include a page bundle.",
      choiceParser("bundle", ["none", "clean", "full"]),
    )
    .option("--job-id <id>", "Retrieve a previously scraped brand job.")
    .option(
      "--output <type>",
      "Retrieve a job artifact (binary files are base64 encoded).",
      choiceParser("output", [
        "html",
        "bundle",
        "screenshot",
        "screenshot_full",
      ]),
    )
    .option(
      "--timeout <seconds>",
      "Local request deadline in seconds.",
      integerParser("timeout", 1),
      300,
    )
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
    .action(async (url, options) => {
      if (Boolean(url) === Boolean(options.jobId))
        throw new Error("Pass either a URL or --job-id, exclusively");
      if (options.output && !options.jobId)
        throw new Error("--output requires --job-id");
      if (options.bundle && options.jobId)
        throw new Error("--bundle requires a URL");
      const result = await runWithSpinner("Loading brand…", () =>
        runWithAuth(options.token, (credential) =>
          options.jobId
            ? getBrand({ ...options, token: credential })
            : scrapeBrand({ ...options, token: credential, url }),
        ),
      );
      printResult(result);
    });

  program
    .command("web-search")
    .description("Search the web and return ranked results.")
    .argument("<query>", "Search query text.")
    .option("--country <code>", "Two-letter result country code.", "us")
    .option(
      "--num-results <n>",
      "Number of results (10–100).",
      integerParser("num results", 10, 100),
      10,
    )
    .option(
      "--timeout <seconds>",
      "Local request deadline in seconds.",
      integerParser("timeout", 1),
      600,
    )
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
    .action(async (query, options) => {
      const result = await runWithSpinner("Searching the web…", () =>
        runWithAuth(options.token, (credential) =>
          webSearch({ ...options, token: credential, query }),
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
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
    .action(async (options) => {
      if (options.json && options.pretty) {
        throw new Error("--json and --pretty cannot be used together");
      }

      const accountResponse = await runWithSpinner(
        "Loading account status…",
        () =>
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
