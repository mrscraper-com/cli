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
  mrscraper get-screenshot "https://example.com" --screenshot top
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
 * Options shared by the page commands. `loading` adds the selector, resource,
 * and cookie controls that scrape-json does not accept.
 * @param {import("commander").Command} command
 * @param {{ loading?: boolean }} [features]
 */
function addPageOptions(command, { loading = true } = {}) {
  command
    .option("--super", "Whether to route the request through real devices.")
    .option(
      "--wait-until <event>",
      "Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2.",
      choiceParser("wait until", [
        "domcontentloaded",
        "load",
        "networkidle0",
        "networkidle2",
      ]),
      "domcontentloaded",
    );
  if (loading) {
    command
      .option(
        "--wait-for-selector <selector>",
        "Wait for the page to contain the specified CSS selector before returning the result.",
      )
      .option(
        "--block-resources",
        "Whether to block images, fonts, and stylesheets while loading the page.",
      )
      .option(
        "--return-cookie",
        "Whether to include browser session cookies in the response.",
      );
  }
  return command
    .option(
      "--timeout <seconds>",
      "Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.",
      integerParser("timeout", 1, 300),
      300,
    )
    .option(
      "--geo-code <code>",
      "Two-letter country code to load the page from, sent in lowercase.",
      "us",
    )
    .option(
      "--proxy-country <code>",
      "Two-letter country code of the proxy server, sent in lowercase.",
      "us",
    )
    .option("--proxy <url>", "Custom proxy URL used to load the page.")
    .option(
      "--max-retries <n>",
      "Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.",
      integerParser("max retries", 0),
    )
    .option(
      "--save-result",
      "Whether to save the result to the dashboard Result tab.",
    )
    .option("--token <key>", "API key used to authenticate the request.");
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
  return dataAction("Retrieving page…", (url, { super: superMode, ...rest }) =>
    call({ ...rest, superMode, url }),
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
    )
      .option(
        "--warm-start",
        "Whether to enable warm start for more reliable scraping, at the cost of additional latency.",
      )
      .option(
        "--browser-rendering",
        "Whether to render the page in a browser before returning the result.",
      ),
  ).action(pageAction(scrapeHtml));

  addPageOptions(
    pageCommand(
      "scrape-markdown",
      "Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.",
    )
      .option("--html", "Whether to include the page HTML in the response.")
      .option(
        "--warm-start",
        "Whether to enable warm start for more reliable scraping, at the cost of additional latency.",
      )
      .option(
        "--browser-rendering",
        "Whether to render the page in a browser before returning the result.",
      ),
  ).action(pageAction(scrapeMarkdown));

  addPageOptions(
    pageCommand(
      "get-screenshot",
      "Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.",
    )
      .option(
        "--screenshot <area>",
        "Screenshot area to capture: full for the entire page or top for the top viewport.",
        choiceParser("screenshot", ["full", "top"]),
        "full",
      )
      .option("--no-html", "Whether to include the page HTML in the response.")
      .option(
        "--markdown",
        "Whether to include the page Markdown in the response.",
      ),
  ).action(pageAction(getScreenshot));

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
        "--screenshot",
        "Whether to include a base64 screenshot in the response.",
      )
      .option(
        "--browser-rendering",
        "Whether to render the page in a browser before returning the result.",
      ),
    { loading: false },
  ).action(pageAction(scrapeJson));

  program
    .command("scrape-brand")
    .description(
      "Extract a website's colors, typography, logos, and social links as JSON.",
    )
    .argument("<url>", "Absolute HTTP or HTTPS URL of the page to process.")
    .option("--token <key>", "API key used to authenticate the request.")
    .action(
      dataAction("Scraping brand…", (url, { token }) =>
        scrapeBrand({ token, url }),
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
      "us",
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
