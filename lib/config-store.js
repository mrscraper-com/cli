import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** @returns {string} */
export function configDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA;
    if (base) return path.join(base, "mrscraper");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "mrscraper");
  return path.join(os.homedir(), ".config", "mrscraper");
}

/** @returns {string} */
export function credentialsPath() {
  return path.join(configDir(), "credentials.json");
}

/** @returns {string | null} */
export function loadSavedApiKey() {
  const file = credentialsPath();
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const key = data.api_key ?? data.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    return null;
  }
  return null;
}

/** @param {string} apiKey @returns {string} absolute path written */
export function saveApiKey(apiKey) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = credentialsPath();
  fs.writeFileSync(
    file,
    `${JSON.stringify({ api_key: apiKey.trim() }, null, 2)}\n`,
    "utf8",
  );
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // ignore
  }
  return file;
}

/** @returns {boolean} */
export function clearSavedApiKey() {
  const file = credentialsPath();
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
