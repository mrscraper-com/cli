---
name: mrscraper-account
description: Check MrScraper account identity, subscription status, token usage, remaining quota, and rate limits through the account command. Use for remote account checks and quota planning; auth status only reports local credential configuration.
---

# Check account status

Use [mrscraper](../mrscraper/SKILL.md) for setup and authentication.
`account` sends an authenticated `GET` request to
`https://api.app.mrscraper.com/api/v1/subscription-accounts`.

```bash
mrscraper account --json
mrscraper account --pretty --no-color
```

Use `--json` for scripts and agents. Interactive terminals show a dashboard
by default. `--timeout` sets the HTTP deadline, defaulting to 30 seconds.

The JSON response is `{ status_code, data: { account }, headers }`. The summary
contains subscription status, enterprise flag, token usage, token limit,
remaining tokens, usage percentage, rate limit, renewal settings, subscription
end date, and the user's name, email, and verification state. Remaining tokens
are clamped to zero for over-quota accounts. API keys and billing identifiers
are excluded.

Treat a 401 response as an authentication failure. Local `mrscraper auth status`
only verifies that a credential is configured; use this operation to check
the remote account. Account usage does not report the progress of a request.
