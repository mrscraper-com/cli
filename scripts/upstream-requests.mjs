#!/usr/bin/env node
/**
 * Print the upstream request the CLI sends for each service input, without
 * network access. Reads {"service-name": {...input}} JSON on stdin and prints
 * {"service-name": {method, url, body}}. build-reference-pdf.py uses it so the
 * reference PDF shows requests generated from lib/api.js.
 */
import { readFileSync } from "node:fs";

const captured = [];
globalThis.fetch = async (url, init = {}) => {
  captured.push({
    method: init.method || "GET",
    url: String(url),
    body: init.body ?? null,
  });
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const api = await import(new URL("../lib/api.js", import.meta.url));
const token = "reference-example-key";
const inputs = JSON.parse(readFileSync(0, "utf8"));
const requests = {};
for (const [name, input] of Object.entries(inputs)) {
  captured.length = 0;
  if (name === "status") {
    await api.getSubscriptionAccountApi(token);
  } else {
    const method = name.replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    await api[method]({ token, ...input });
  }
  if (captured.length !== 1) {
    throw new Error(`${name} sent ${captured.length} requests instead of 1`);
  }
  requests[name] = captured[0];
}
process.stdout.write(`${JSON.stringify(requests, null, 2)}\n`);
