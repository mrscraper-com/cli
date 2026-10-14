import test from "node:test";
import assert from "node:assert/strict";
import {
  renderStatusDashboard,
  summarizeSubscriptionAccount,
} from "../lib/status.js";

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

test("status dashboard highlights account health and quota", () => {
  const dashboard = renderStatusDashboard({
    status_code: 200,
    data: {
      account: summarizeSubscriptionAccount({
        tokenLimit: 50_000,
        tokenUsage: 12_345,
        stripeStatus: "active",
        isEnterprise: true,
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
      }),
    },
  });

  assert.match(dashboard, /MrScraper  ACCOUNT & USAGE/);
  assert.match(dashboard, /● ACTIVE\s+ENTERPRISE/);
  assert.match(dashboard, /12,345 used\s+·\s+37,655 remaining/);
  assert.match(dashboard, /Rate limit\s+30 requests \/ 60s/);
  assert.doesNotMatch(dashboard, /atk_secret|stripeSubscriptionId/);
  assert.doesNotMatch(dashboard, /\x1b\[/);
});

test("status dashboard renders an actionable API failure", () => {
  const dashboard = renderStatusDashboard({
    status_code: 401,
    error: "Unauthorized",
  });

  assert.match(dashboard, /● UNAVAILABLE/);
  assert.match(dashboard, /Unauthorized/);
  assert.match(dashboard, /HTTP status\s+401/);
  assert.match(dashboard, /mrscraper login/);
});
