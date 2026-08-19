import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authPath,
  clearAuth,
  configDir,
  legacyCredentialsPath,
  loadAuth,
  loadSavedApiKey,
  saveApiKey,
} from "../lib/config-store.js";

function temporaryRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mrscraper-auth-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("auth storage defaults to ~/.mrscraper/auth.json and honors MRSCRAPER_HOME", (t) => {
  const homeDirectory = temporaryRoot(t);
  assert.equal(
    configDir({ homeDirectory, environment: {} }),
    path.join(homeDirectory, ".mrscraper"),
  );
  assert.equal(
    authPath({ homeDirectory, environment: {} }),
    path.join(homeDirectory, ".mrscraper", "auth.json"),
  );

  const configured = path.join(homeDirectory, "custom-auth-home");
  assert.equal(
    authPath({
      homeDirectory,
      environment: { MRSCRAPER_HOME: configured },
    }),
    path.join(configured, "auth.json"),
  );
});

test("API keys are written atomically to auth.json with private permissions", (t) => {
  const homeDirectory = temporaryRoot(t);
  const options = { homeDirectory, environment: {} };
  const file = saveApiKey("  api-secret  ", options);

  assert.equal(file, path.join(homeDirectory, ".mrscraper", "auth.json"));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    version: 1,
    auth_type: "api_key",
    api_key: "api-secret",
  });
  assert.equal(loadSavedApiKey(options), "api-secret");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("the previous credentials.json API key migrates once", (t) => {
  const homeDirectory = temporaryRoot(t);
  const options = { homeDirectory, environment: {}, platform: "darwin" };
  const legacyFile = legacyCredentialsPath(options);
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, '{"api_key":"legacy-secret"}\n', "utf8");

  assert.deepEqual(loadAuth(options), {
    version: 1,
    auth_type: "api_key",
    api_key: "legacy-secret",
  });
  assert.equal(fs.existsSync(authPath(options)), true);
  assert.equal(fs.existsSync(legacyFile), false);
});

test("clearAuth removes current and legacy credential files", (t) => {
  const homeDirectory = temporaryRoot(t);
  const options = { homeDirectory, environment: {}, platform: "darwin" };
  saveApiKey("current-secret", options);
  const legacyFile = legacyCredentialsPath(options);
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, '{"api_key":"old-secret"}\n', "utf8");

  assert.equal(clearAuth(options), true);
  assert.equal(fs.existsSync(authPath(options)), false);
  assert.equal(fs.existsSync(legacyFile), false);
});
