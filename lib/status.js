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

/** @param {unknown} value */
function recordOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** @param {unknown} value */
function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(numberOrZero(value));
}

/** @param {unknown} value */
function humanize(value) {
  const text = String(value || "unknown").trim();
  if (!text) return "Unknown";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** @param {unknown} value */
function formatStatusDate(value) {
  if (!value) return "Not scheduled";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed)} UTC`;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** @param {string} value */
function visibleLength(value) {
  return value.replace(ANSI_PATTERN, "").length;
}

/** @param {string} value @param {number} width */
function fit(value, width) {
  const plain = value.replace(ANSI_PATTERN, "");
  if (plain.length <= width) return `${value}${" ".repeat(width - plain.length)}`;
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

/** @param {unknown} value @param {number} width */
function clip(value, width) {
  const text = String(value);
  const plain = text.replace(ANSI_PATTERN, "");
  if (plain.length <= width) return text;
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * Render a terminal dashboard for the normalized `status` response.
 * ANSI color is opt-in so redirected output and tests remain stable.
 *
 * @param {Record<string, unknown>} result
 * @param {{ color?: boolean; width?: number }} [options]
 */
export function renderStatusDashboard(result, options = {}) {
  const color = Boolean(options.color);
  const width = Math.max(44, Math.min(80, Number(options.width) || 68));
  const innerWidth = width - 6;
  const data = recordOrEmpty(result?.data);
  const account = recordOrEmpty(data.account);
  const analytics = recordOrEmpty(data.analytics);

  const paint = (code, value) =>
    color ? `\x1b[${code}m${String(value)}\x1b[0m` : String(value);
  const muted = (value) => paint("2", value);
  const bold = (value) => paint("1", value);
  const cyan = (value) => paint("36", value);
  const green = (value) => paint("32", value);
  const yellow = (value) => paint("33", value);
  const red = (value) => paint("31", value);

  const lines = [];
  const boxLine = (value = "") => {
    const fitted = fit(value, innerWidth);
    lines.push(`${cyan("│")}  ${fitted}  ${cyan("│")}`);
  };
  const section = (title) => {
    lines.push("");
    lines.push(`  ${muted(title.toUpperCase())}`);
  };
  const line = (value) => {
    lines.push(`  ${clip(value, width - 2)}`);
  };
  const row = (label, value) => {
    const labelWidth = 16;
    const plainLabel = String(label).slice(0, labelWidth);
    line(`${muted(plainLabel.padEnd(labelWidth))}${String(value)}`);
  };

  lines.push(cyan(`╭${"─".repeat(width - 2)}╮`));
  boxLine(`${bold("◆ MrScraper")}  ${muted("ACCOUNT & USAGE")}`);
  boxLine(muted("Scraping infrastructure at a glance"));
  lines.push(cyan(`╰${"─".repeat(width - 2)}╯`));

  if (!Object.keys(account).length) {
    section("Account");
    line(red("● UNAVAILABLE"));
    line(
      result?.error
        ? String(result.error)
        : "Account information could not be loaded.",
    );
    if (result?.status_code) row("HTTP status", result.status_code);
    lines.push("");
    line(muted("Run `mrscraper login` if authentication has expired."));
    return lines.join("\n");
  }

  const rawStatus = String(account.subscription_status || "unknown").toLowerCase();
  const healthyStatuses = new Set(["active", "trialing"]);
  const warningStatuses = new Set(["past_due", "incomplete", "paused"]);
  const statusText = `● ${humanize(rawStatus).toUpperCase()}`;
  const styledStatus = healthyStatuses.has(rawStatus)
    ? green(statusText)
    : warningStatuses.has(rawStatus)
      ? yellow(statusText)
      : rawStatus === "unknown"
        ? muted(statusText)
        : red(statusText);
  const enterpriseBadge = account.enterprise ? `  ${cyan("ENTERPRISE")}` : "";

  section("Account");
  line(`${bold(styledStatus)}${enterpriseBadge}`);
  const user = recordOrEmpty(account.user);
  const identity = [user.name, user.email].filter(Boolean).join("  ·  ");
  if (identity && visibleLength(identity) <= width - 2) {
    line(identity);
  } else {
    if (user.name) line(user.name);
    if (user.email) line(muted(user.email));
  }
  line(
    user.verified ? green("✓ Verified account") : yellow("○ Account not verified"),
  );

  section("Token usage");
  const tokenLimit = numberOrZero(account.token_limit);
  const tokenUsage = numberOrZero(account.token_usage);
  const tokenRemaining = numberOrZero(account.token_remaining);
  const usagePercent = numberOrZero(account.usage_percent);
  if (tokenLimit > 0) {
    const barWidth = Math.max(18, Math.min(32, width - 36));
    const boundedPercent = Math.max(0, Math.min(100, usagePercent));
    const usedCells = Math.round((boundedPercent / 100) * barWidth);
    const barColor = usagePercent >= 90 ? red : usagePercent >= 75 ? yellow : green;
    const bar = `${barColor("█".repeat(usedCells))}${muted("░".repeat(barWidth - usedCells))}`;
    line(`${bar}  ${bold(`${formatNumber(usagePercent)}%`)}`);
    const usedAndRemaining = `${formatNumber(tokenUsage)} used  ${muted("·")}  ${formatNumber(tokenRemaining)} remaining`;
    const usageSummary = `${usedAndRemaining}  ${muted("·")}  ${formatNumber(tokenLimit)} total`;
    if (visibleLength(usageSummary) <= width - 2) {
      line(usageSummary);
    } else {
      line(usedAndRemaining);
      line(`${formatNumber(tokenLimit)} total`);
    }
  } else {
    line(`${formatNumber(tokenUsage)} tokens used`);
    line(
      muted(
        account.enterprise
          ? "Enterprise or custom quota"
          : "No token quota was reported for this account.",
      ),
    );
  }

  section("Limits & billing");
  const rateLimit = numberOrZero(account.rate_limit);
  const rateTtl = numberOrZero(account.rate_ttl);
  row(
    "Rate limit",
    rateLimit > 0
      ? `${formatNumber(rateLimit)} requests${rateTtl > 0 ? ` / ${formatNumber(rateTtl)}s` : ""}`
      : "Not reported",
  );
  row("Auto-renew", account.auto_renew ? green("Enabled") : yellow("Disabled"));
  row("Ends", formatStatusDate(account.ends_at));

  if (Object.keys(analytics).length) {
    section("Domain analytics");
    if (analytics.domain) row("Domain", analytics.domain);
    if (analytics.from) row("From", analytics.from);
    if (analytics.to) row("To", analytics.to);

    const analyticsFailed =
      Boolean(analytics.error) || numberOrZero(analytics.status_code) >= 400;
    if (analyticsFailed) {
      row("Status", red("Unavailable"));
      if (analytics.error) row("Reason", analytics.error);
    } else {
      if (analytics.countAll !== undefined) {
        row("Requests", formatNumber(analytics.countAll));
      }
      if (analytics.successRate !== undefined) {
        const successRate = numberOrZero(analytics.successRate);
        const styledRate = successRate >= 90
          ? green(`${formatNumber(successRate)}%`)
          : successRate >= 70
            ? yellow(`${formatNumber(successRate)}%`)
            : red(`${formatNumber(successRate)}%`);
        row("Success rate", styledRate);
      }
    }
  }

  lines.push("");
  const hint = "Tip: pass --json for machine-readable output";
  line(muted(hint));

  // Guard against an accidental ANSI-padding regression in the boxed header.
  if (visibleLength(lines[1]) !== width) {
    throw new Error("Unable to render status dashboard header");
  }

  return lines.join("\n");
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
