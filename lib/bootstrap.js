import { execFileSync } from "node:child_process";
import { VERSION } from "./version.js";
import {
  cleanNpmEnvironment,
  formatCommand,
  installMrscraperSkill,
  npmExecutable,
} from "./skills-installer.js";
import { installMrscraperMcp } from "./mcp-installer.js";

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions} options
 */
function defaultExecute(executable, args, options) {
  return execFileSync(executable, args, options);
}

/**
 * @param {{
 *   version?: string,
 *   packageSpec?: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   execute?: typeof defaultExecute,
 *   dryRun?: boolean,
 *   log?: (message: string) => void,
 * }} [options]
 */
export function installGlobalCli(options = {}) {
  const {
    version = VERSION,
    environment = process.env,
    packageSpec =
      environment.MRSCRAPER_CLI_PACKAGE_SPEC || `@mrscraper/cli@${version}`,
    platform = process.platform,
    execute = defaultExecute,
    dryRun = false,
    log = console.log,
  } = options;
  const executable = npmExecutable(platform);
  const args = ["install", "--global", packageSpec];
  const rendered = formatCommand([executable, ...args]);

  if (dryRun) {
    log(`Would install the MrScraper CLI globally: ${rendered}`);
  } else {
    log(`Installing ${packageSpec} globally…`);
    execute(executable, args, {
      stdio: "inherit",
      env: cleanNpmEnvironment(environment),
    });
  }

  return { command: executable, args };
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the complete agent bootstrap while keeping authentication owned by the
 * CLI's existing credential implementation.
 *
 * @param {{
 *   agent?: string,
 *   apiKey?: string,
 *   yes?: boolean,
 *   nonInteractive?: boolean,
 *   dryRun?: boolean,
 *   skipInstall?: boolean,
 *   skipAuth?: boolean,
 *   skipSkills?: boolean,
 *   skipMcp?: boolean,
 * }} options
 * @param {{
 *   installCli?: typeof installGlobalCli,
 *   installSkill?: typeof installMrscraperSkill,
 *   installMcp?: typeof installMrscraperMcp,
 *   hasCredentials?: () => boolean | Promise<boolean>,
 *   authenticate?: (apiKey?: string) => void | Promise<void>,
 *   log?: (message: string) => void,
 *   logError?: (message: string) => void,
 * }} dependencies
 */
export async function runBootstrap(options = {}, dependencies = {}) {
  const {
    installCli = installGlobalCli,
    installSkill = installMrscraperSkill,
    installMcp = installMrscraperMcp,
    hasCredentials = () => false,
    authenticate = async () => {},
    log = console.log,
    logError = console.error,
  } = dependencies;
  const failures = [];
  const leaveAuthenticationForLater = Boolean(
    options.yes || options.nonInteractive,
  );

  const attempt = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ label, error });
      logError(`${label} failed: ${errorMessage(error)}`);
    }
  };

  log("MrScraper agent bootstrap");

  if (!options.skipInstall) {
    await attempt("Global CLI installation", () =>
      installCli({ dryRun: options.dryRun, log }),
    );
  } else {
    log("Skipping global CLI installation.");
  }

  if (!options.skipAuth) {
    await attempt("Authentication", async () => {
      if (options.dryRun) {
        if (options.apiKey) {
          log("Would save the supplied MrScraper API key.");
        } else if (await hasCredentials()) {
          log("MrScraper credentials are already configured.");
        } else if (leaveAuthenticationForLater) {
          log("Would leave authentication for explicit `mrscraper login`.");
        } else {
          log("Would securely prompt for a MrScraper API key.");
        }
        return;
      }
      if (options.apiKey) {
        await authenticate(options.apiKey);
        return;
      }
      if (await hasCredentials()) {
        log("MrScraper credentials are already configured.");
        return;
      }
      if (leaveAuthenticationForLater) {
        log(
          "Authentication not configured; set MRSCRAPER_API_KEY or run `mrscraper login` explicitly before web requests.",
        );
        return;
      }
      await authenticate();
    });
  } else {
    log("Skipping authentication.");
  }

  if (!options.skipSkills) {
    await attempt("Skill pack installation", () =>
      installSkill({ agent: options.agent, dryRun: options.dryRun, log }),
    );
  } else {
    log("Skipping skill pack installation.");
  }

  if (!options.skipMcp) {
    await attempt("MCP installation", () =>
      installMcp({ agent: options.agent, dryRun: options.dryRun, log }),
    );
  } else {
    log("Skipping MCP installation.");
  }

  if (failures.length > 0) {
    throw new Error(
      `Bootstrap completed with ${failures.length} error${failures.length === 1 ? "" : "s"}.`,
    );
  }

  log("MrScraper setup is complete.");
  return { ok: true };
}
