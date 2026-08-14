import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export const AUTH_FILE_VERSION = 1;

/**
 * @typedef {{
 *   version: 1,
 *   auth_type: 'api_key',
 *   api_key: string,
 * }} StoredAuth
 */

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 * @returns {string}
 */
export function configDir(options = {}) {
  const environment = options.environment || process.env;
  const configured = environment.MRSCRAPER_HOME?.trim();
  if (configured) return path.resolve(configured);
  return path.join(options.homeDirectory || os.homedir(), ".mrscraper");
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 * @returns {string}
 */
export function authPath(options = {}) {
  return path.join(configDir(options), "auth.json");
}

/** Backward-compatible export for callers of the original config store. */
export function credentialsPath(options = {}) {
  return authPath(options);
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, platform?: NodeJS.Platform}} [options]
 * @returns {string}
 */
export function legacyCredentialsPath(options = {}) {
  const environment = options.environment || process.env;
  const homeDirectory = options.homeDirectory || os.homedir();
  const platform = options.platform || process.platform;

  if (platform === "win32") {
    const base = environment.LOCALAPPDATA || environment.APPDATA;
    if (base) return path.join(base, "mrscraper", "credentials.json");
  }
  const xdg = environment.XDG_CONFIG_HOME;
  const base = xdg || path.join(homeDirectory, ".config");
  return path.join(base, "mrscraper", "credentials.json");
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 * @returns {string}
 */
export function ensureConfigDir(options = {}) {
  const directory = configDir(options);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Some filesystems do not expose POSIX modes.
  }
  return directory;
}

/** @param {unknown} value @returns {StoredAuth | null} */
function normalizeAuth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const authType = value.auth_type || (value.api_key || value.apiKey ? "api_key" : null);

  if (authType === "api_key") {
    const apiKey = value.api_key ?? value.apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim()) return null;
    return {
      version: AUTH_FILE_VERSION,
      auth_type: "api_key",
      api_key: apiKey.trim(),
    };
  }

  return null;
}

/** @param {string} file @returns {unknown | null} */
function readJsonFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {StoredAuth | Record<string, unknown>} auth
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 * @returns {string}
 */
export function saveAuth(auth, options = {}) {
  const normalized = normalizeAuth(auth);
  if (!normalized) throw new Error("Invalid MrScraper authentication record");

  const directory = ensureConfigDir(options);
  const file = authPath(options);
  const temporary = path.join(
    directory,
    `.auth.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Some filesystems do not expose POSIX modes.
    }
    return file;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Ignore cleanup errors after a failed write.
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The atomic rename normally removes the temporary path.
    }
  }
}

/**
 * Load the current auth record and migrate the previous credentials file on
 * first use. The legacy file is removed only after the new file is durable.
 *
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, platform?: NodeJS.Platform}} [options]
 * @returns {StoredAuth | null}
 */
export function loadAuth(options = {}) {
  const current = normalizeAuth(readJsonFile(authPath(options)));
  if (current) return current;

  const legacyFile = legacyCredentialsPath(options);
  const legacy = normalizeAuth(readJsonFile(legacyFile));
  if (!legacy || legacy.auth_type !== "api_key") return null;

  saveAuth(legacy, options);
  if (legacyFile !== authPath(options)) {
    try {
      fs.unlinkSync(legacyFile);
    } catch {
      // Keeping a legacy backup is safer than failing authentication.
    }
  }
  return legacy;
}

/**
 * @param {string} apiKey
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string}} [options]
 * @returns {string}
 */
export function saveApiKey(apiKey, options = {}) {
  return saveAuth(
    {
      version: AUTH_FILE_VERSION,
      auth_type: "api_key",
      api_key: String(apiKey || "").trim(),
    },
    options,
  );
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, platform?: NodeJS.Platform}} [options]
 * @returns {string | null}
 */
export function loadSavedApiKey(options = {}) {
  const auth = loadAuth(options);
  return auth?.auth_type === "api_key" ? auth.api_key : null;
}

/**
 * @param {{environment?: NodeJS.ProcessEnv, homeDirectory?: string, platform?: NodeJS.Platform}} [options]
 * @returns {boolean}
 */
export function clearAuth(options = {}) {
  let removed = false;
  for (const file of new Set([authPath(options), legacyCredentialsPath(options)])) {
    try {
      fs.unlinkSync(file);
      removed = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return removed;
}

/** Backward-compatible export for callers of the original config store. */
export function clearSavedApiKey(options = {}) {
  return clearAuth(options);
}
