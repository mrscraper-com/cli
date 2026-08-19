import test from "node:test";
import assert from "node:assert/strict";

import {
  BrowserLoginError,
  loginViaBrowser,
} from "../lib/browser-login.js";

test("browser callback ignores invalid state and token-only legacy callbacks", async () => {
  let invalidStateStatus;
  let tokenStatus;
  let callbackRequest;

  const result = await loginViaBrowser({
    appBaseUrl: "https://app.mrscraper.test",
    timeoutMs: 2_000,
    log: () => {},
    openBrowserFn: async (url) => {
      const authorizationUrl = new URL(url);
      const callback = new URL(
        authorizationUrl.searchParams.get("cli_redirect"),
      );

      const invalidState = new URL(callback);
      invalidState.searchParams.set("code", "forged-code");
      invalidState.searchParams.set("state", "wrong-state");
      invalidStateStatus = (await fetch(invalidState)).status;

      const tokenOnly = new URL(callback);
      tokenOnly.searchParams.set("token", "must-not-be-accepted");
      tokenOnly.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state"),
      );
      tokenStatus = (await fetch(tokenOnly)).status;

      callback.searchParams.set("code", "valid-code");
      callback.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state"),
      );
      callbackRequest = fetch(callback);
      return true;
    },
  });
  await callbackRequest;

  assert.equal(invalidStateStatus, 400);
  assert.equal(tokenStatus, 400);
  assert.equal(result.code, "valid-code");
  assert.ok(result.codeVerifier.length >= 43);
});

test("browser denial terminates the pending login", async () => {
  await assert.rejects(
    loginViaBrowser({
      appBaseUrl: "https://app.mrscraper.test",
      timeoutMs: 2_000,
      log: () => {},
      openBrowserFn: async (url) => {
        const authorizationUrl = new URL(url);
        const callback = new URL(
          authorizationUrl.searchParams.get("cli_redirect"),
        );
        callback.searchParams.set("error", "access_denied");
        callback.searchParams.set(
          "state",
          authorizationUrl.searchParams.get("state"),
        );
        void fetch(callback);
        return true;
      },
    }),
    (error) =>
      error instanceof BrowserLoginError && error.code === "denied",
  );
});

test("no-open prints the URL without launching a browser", async () => {
  let opened = false;
  const messages = [];

  await assert.rejects(
    loginViaBrowser({
      appBaseUrl: "https://app.mrscraper.test",
      timeoutMs: 10,
      noOpen: true,
      openBrowserFn: async () => {
        opened = true;
        return true;
      },
      log: (message) => messages.push(message),
    }),
    (error) =>
      error instanceof BrowserLoginError && error.code === "timeout",
  );

  assert.equal(opened, false);
  assert.match(messages.join("\n"), /Open this URL to log in/);
});
