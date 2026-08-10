import test from "node:test";
import assert from "node:assert/strict";
import {
  formatApiDate,
  parseStatusDate,
  summarizeSubscriptionAccount,
} from "../lib/status.js";

test("status durations are relative to the supplied time", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  assert.equal(
    parseStatusDate("24h", now).toISOString(),
    "2026-08-09T12:00:00.000Z",
  );
  assert.equal(formatApiDate(now), "2026-08-10 12:00:00");
});

test("account status is concise and excludes credentials", () => {
  const summary = summarizeSubscriptionAccount({
    tokenLimit: 1000,
    tokenUsage: 250,
    stripeStatus: "active",
    stripeSubscriptionId: "sub_secret",
    isEnterprise: false,
    rateLimit: 30,
    rateTtl: 60,
    isAutoRenew: true,
    endsAt: "2026-09-01T00:00:00Z",
    user: {
      name: "Ada",
      email: "ada@example.com",
      latestApiToken: "atk_secret",
      isVerified: true,
    },
  });

  assert.equal(summary.token_remaining, 750);
  assert.equal(summary.usage_percent, 25);
  assert.equal(summary.user.email, "ada@example.com");
  assert.doesNotMatch(JSON.stringify(summary), /atk_secret|sub_secret/);
});
