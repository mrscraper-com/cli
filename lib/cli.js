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
    .option("--super", "Route the request through real devices.")
    .option(
      "--wait-until <event>",
      "Navigation completion event: domcontentloaded, load, networkidle0, or networkidle2.",
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
      .option("--wait-for-selector <selector>", "Wait for a CSS selector.")
      .option("--block-resources", "Block images, fonts, and stylesheets.")
      .option(
        "--return-cookie",
        "Include browser session cookies in the response.",
      );
  }
  return command
    .option(
      "--timeout <seconds>",
      "Page load timeout, 1–300; the request allows 30 seconds more.",
      integerParser("timeout", 1, 300),
      300,
    )
    .option("--geo-code <code>", "Country to load the page from.", "us")
    .option("--proxy-country <code>", "Country of the proxy server.", "us")
    .option("--proxy <url>", "Send the request through your own proxy.")
    .option(
      "--max-retries <n>",
      "Maximum retries; omit for no limit.",
      integerParser("max retries", 0),
    )
    .option("--save-result", "Save the result to the dashboard Result tab.")
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
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
      .argument("<url>", "Absolute HTTP or HTTPS page URL.");

  addPageOptions(
    pageCommand("scrape-html", "Retrieve the raw HTML of a page.").option(
      "--browser-rendering",
      "Render the page in a browser.",
    ),
  ).action(pageAction(scrapeHtml));

  addPageOptions(
    pageCommand("scrape-markdown", "Retrieve clean Markdown from a page.")
      .option(
        "--html",
        "Also return the page HTML as JSON with both; renders in a browser.",
      )
      .option("--browser-rendering", "Render the page in a browser."),
  ).action(pageAction(scrapeMarkdown));

  addPageOptions(
    pageCommand(
      "get-screenshot",
      "Capture a full-page or top-viewport screenshot in a browser.",
    )
      .option(
        "--screenshot <area>",
        "Capture the full page or the top viewport.",
        choiceParser("screenshot", ["full", "top"]),
        "full",
      )
      .option("--no-html", "Omit the page HTML.")
      .option("--markdown", "Also return the page Markdown."),
  ).action(pageAction(getScreenshot));

  addPageOptions(
    pageCommand(
      "scrape-json",
      "Extract structured JSON using a natural-language prompt.",
    )
      .option(
        "--prompt <text>",
        "Data to extract; append 'Json Schema:' and a schema to shape it.",
        DEFAULT_JSON_PROMPT,
      )
      .option("--html", "Also return the page HTML.")
      .option("--screenshot", "Also return a base64 screenshot.")
      .option("--browser-rendering", "Render the page in a browser."),
    { loading: false },
  ).action(pageAction(scrapeJson));

  program
    .command("scrape-brand")
    .description(
      "Extract a website's colors, typography, logos, and social links.",
    )
    .argument("<url>", "Absolute HTTP or HTTPS page URL.")
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
    .action(
      dataAction("Scraping brand…", (url, { token }) =>
        scrapeBrand({ token, url }),
      ),
    );

  program
    .command("web-search")
    .description("Search the web and return ranked results.")
    .argument("<query>", "Search query, 1–1000 characters.")
    .option("--country <code>", "Country to search from.", "us")
    .option(
      "--num-results <n>",
      "Number of results, 10–100; fewer may be returned.",
      integerParser("num results", 10, 100),
      10,
    )
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
    .action(
      dataAction("Searching the web…", (query, options) =>
        webSearch({ ...options, query }),
      ),
    );

  program
    .command("status")
    .description("Return the raw account status API response as JSON.")
    .option("--json", "Print JSON (the default).")
    .option(
      "--token <key>",
      "Override configured authentication with an API key.",
    )
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
