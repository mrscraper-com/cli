/** @param {Date} date */
export function formatApiDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/**
 * Parse an ISO date, `now`, or a duration such as `24h`, `7d`, or `30m`.
 * Durations are interpreted as that amount of time before `now`.
 * @param {string | undefined} value
 * @param {Date} now
 * @param {string} fallbackDuration
 */
export function parseStatusDate(value, now = new Date(), fallbackDuration = "24h") {
  const input = (value || fallbackDuration).trim().toLowerCase();
  if (input === "now") return new Date(now);

  const relative = /^(\d+)(m|h|d|w)$/.exec(input);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    }[relative[2]];
    return new Date(now.getTime() - amount * unitMs);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date "${value}". Use ISO 8601, "now", or a duration such as 24h or 7d.`,
    );
  }
  return parsed;
}

/** @param {unknown} value */
function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Remove billing identifiers and API tokens while producing a concise status.
 * @param {Record<string, unknown>} account
 */
export function summarizeSubscriptionAccount(account) {
  const tokenLimit = numberOrZero(account.tokenLimit);
  const tokenUsage = numberOrZero(account.tokenUsage);
  const user =
    account.user && typeof account.user === "object" ? account.user : {};

  return {
    subscription_status: account.stripeStatus ?? null,
    enterprise: Boolean(account.isEnterprise),
    token_usage: tokenUsage,
    token_limit: tokenLimit,
    token_remaining: Math.max(0, tokenLimit - tokenUsage),
    usage_percent:
      tokenLimit > 0 ? Number(((tokenUsage / tokenLimit) * 100).toFixed(2)) : 0,
    rate_limit: numberOrZero(account.rateLimit),
    rate_ttl: numberOrZero(account.rateTtl),
    auto_renew: Boolean(account.isAutoRenew),
    ends_at: account.endsAt ?? null,
    user: {
      name: user.name ?? null,
      email: user.email ?? null,
      verified: Boolean(user.isVerified),
    },
  };
}
