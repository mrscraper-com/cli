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
  scrapeJson,
  webSearch,
  DEFAULT_JSON_PROMPT,
} from "./api.js";
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
  mrscraper scrape-html "https://example.com"
  mrscraper scrape-markdown "https://example.com"
  mrscraper get-screenshot "https://example.com"
  mrscraper scrape-brand "https://mrscraper.com/"
  mrscraper scrape-json "https://example.com" --prompt "Extract titles and prices"
  mrscraper web-search "site:example.com documentation" --country id
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
          (typeof brandJob.error === "string" && brandJob.error.length > 0))) ||
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

/**
 * Standard parameter descriptions shared with the SDKs and integrations; the
 * reference test checks them against docs/service-reference.json.
 */
const PARAMETER_HELP = Object.freeze({
  browserRendering:
    "Whether to load the page in a browser: true always does and false never does. Omit it to load the page without a browser first and switch to a browser automatically if the request is blocked.",
  timeout:
    "Maximum seconds to wait for the scrape, from 1 to 330. The HTTP request allows 30 additional seconds.",
  warmStart:
    "Whether to open the site's home page first to warm the session before loading the target URL.",
  blockResources:
    "Whether to block images, fonts, and stylesheets while loading the page.",
  waitForSelector:
    "CSS selector or text to wait for on the page before returning the result, up to 500 characters.",
  action:
    "Scraper action that routes the request or simply flags it, useful for separating analytics per domain.",
  geoCode: "Two-letter country code to load the page from, sent in lowercase.",
  maxAge:
    "Return a cached result of the same request when it is newer than the selected age. A cached result costs the same tokens as the original scrape.",
  maxRetries:
    "Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.",
});

/**
 * Page controls shared by HTML, Markdown, screenshots, and JSON extraction.
 * `loading` adds browser rendering, warm start, and resource blocking, which
 * screenshots do not accept; `action` is accepted by HTML and Markdown only.
 * Paired --x/--no-x flags leave the option unset unless one is passed, so the
 * documented API default applies.
 * @param {import("commander").Command} command
 * @param {{ loading?: boolean, action?: boolean }} [features]
 */
function addPageOptions(command, { loading = true, action = false } = {}) {
  if (loading) {
    command
      .option("--browser-rendering", PARAMETER_HELP.browserRendering)
      .option(
        "--no-browser-rendering",
        "Never load the page in a browser; sends browserRendering=false.",
      );
  }
  command.option(
    "--timeout <seconds>",
    PARAMETER_HELP.timeout,
    integerParser("timeout", 1, 330),
    300,
  );
  if (loading) {
    command
      .option("--warm-start", PARAMETER_HELP.warmStart)
      .option("--block-resources", PARAMETER_HELP.blockResources);
  }
  command.option(
    "--wait-for-selector <selector>",
    PARAMETER_HELP.waitForSelector,
  );
  if (action) command.option("--action <name>", PARAMETER_HELP.action);
  return command
    .option("--geo-code <code>", PARAMETER_HELP.geoCode)
    .option(
      "--max-age <milliseconds>",
      PARAMETER_HELP.maxAge,
      integerParser("max age", 0, 604800000),
      0,
    )
    .option(
      "--max-retries <n>",
      PARAMETER_HELP.maxRetries,
      integerParser("max retries", 0),
    );
}

/**
 * Resolve authentication, call one API operation, and print its envelope.
 * @param {string} waitMessage
 * @param {(input: string, options: Record<string, any>) => Promise<unknown>} call
 */
function dataAction(waitMessage, call) {
  return async (input, options) => {
    const result = await runWithSpinner(waitMessage, () =>
      runWithAuth(options.token, (token) => call(input, { ...options, token })),
    );
    printResult(result);
  };
}

/** @param {(options: Record<string, any>) => Promise<unknown>} call */
function pageAction(call) {
  return dataAction("Retrieving page…", (url, options) =>
    call({ ...options, url }),
  );
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

  const pageCommand = (name, description) =>
    program
      .command(name)
      .description(description)
      .argument("<url>", "Absolute HTTP or HTTPS URL of the page to process.");

  addPageOptions(
    pageCommand(
      "scrape-html",
      "Retrieve the raw HTML of a page. Browser rendering is optional.",
    ),
    { action: true },
  )
    .option(
      "--screenshot <capture>",
      "Screenshot to capture with the HTML: false for none, full for the entire page, top for the first viewport, or a WIDTHxHEIGHT viewport from 100 to 3840 pixels with an optional -ZOOM percent from 25 to 300, such as 1280x800 or 1920x1080-75. Setting a screenshot also sends browserRendering=true.",
      (value) => (value === "false" ? false : value),
    )
    .option("--token <key>", "API key used to authenticate the request.")
    .action(pageAction(scrapeHtml));

  addPageOptions(
    pageCommand(
      "scrape-markdown",
      "Retrieve a page as clean Markdown. Browser rendering is optional.",
    ),
    { action: true },
  )
    .option("--token <key>", "API key used to authenticate the request.")
    .action(pageAction(scrapeMarkdown));

  addPageOptions(
    pageCommand(
      "get-screenshot",
      "Capture a base64 PNG screenshot of the full page. Browser rendering is always enabled.",
    ),
    { loading: false },
  )
    .option("--token <key>", "API key used to authenticate the request.")
    .action(pageAction(getScreenshot));

  addPageOptions(
    pageCommand(
      "scrape-json",
      "Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.",
    )
      .option(
        "--prompt <text>",
        "Instructions describing the data to extract. Append Json Schema: and a JSON schema to shape the output.",
        DEFAULT_JSON_PROMPT,
      )
      .option("--html", "Whether to include the page HTML in the response.")
      .option(
        "--no-html",
        "Leave the page HTML out of the response; sends html=false.",
      ),
  )
    .option(
      "--screenshot",
      "Whether to include a base64 screenshot in the response.",
    )
    .option("--token <key>", "API key used to authenticate the request.")
    .action(pageAction(scrapeJson));

  program
    .command("scrape-brand")
    .description(
      "Extract a website's colors, typography, logos, and social links as JSON.",
    )
    .argument("<url>", "Absolute HTTP or HTTPS URL of the page to process.")
    .option(
      "--timeout <seconds>",
      PARAMETER_HELP.timeout,
      integerParser("timeout", 1, 330),
    )
    .option("--warm-start", PARAMETER_HELP.warmStart)
    .option("--geo-code <code>", PARAMETER_HELP.geoCode)
    .option("--token <key>", "API key used to authenticate the request.")
    .action(
      dataAction("Scraping brand…", (url, options) =>
        scrapeBrand({ ...options, url }),
      ),
    );

  program
    .command("web-search")
    .description(
      "Search the web and return ranked results with titles, URLs, descriptions, and sources.",
    )
    .argument(
      "<query>",
      "Search query text, trimmed before sending, containing 1 to 1000 characters.",
    )
    .option(
      "--country <code>",
      "Two-letter country code to search from, sent in lowercase.",
    )
    .option(
      "--num-results <n>",
      "Number of search results to request, as an integer from 10 to 100. Fewer results may be returned.",
      integerParser("num results", 10, 100),
      10,
    )
    .option("--token <key>", "API key used to authenticate the request.")
    .action(
      dataAction("Searching the web…", (query, options) =>
        webSearch({ ...options, query }),
      ),
    );

  program
    .command("status")
    .description(
      "Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.",
    )
    .option("--json", "Print JSON (the default).")
    .option("--token <key>", "API key used to authenticate the request.")
    .action(async (options) => {
      const accountResponse = await runWithSpinner(
        "Loading account status…",
        () =>
          runWithAuth(options.token, (credential) =>
            getSubscriptionAccountApi(credential),
          ),
      );
      printResult(accountResponse);
    });

  await program.parseAsync(argv);
}
