# MrScraper CLI and Local MCP OAuth Backend Contract

This document defines the backend work required by the OAuth client implemented
in `@mrscraper/cli`. Until these endpoints and resource-server changes are
deployed, users must continue authenticating with an API key.

`@mrscraper/mcp` reuses this same public client when it runs locally over
stdio. It reads and refreshes the CLI's `~/.mrscraper/auth.json` under the same
lock, so the backend does not need a second MCP-specific OAuth client or token
format. Hosted HTTP MCP remains caller-authenticated and is a separate
deployment boundary.

## Required OAuth client registration

Register one public native client with these defaults:

| Setting | Required value |
| --- | --- |
| Client ID | `mrscraper-cli` |
| Client type | Public; no client secret |
| Grant types | Authorization code and refresh token |
| PKCE | Required, `S256` only |
| Redirect URI | `http://127.0.0.1:{ephemeral-port}/oauth/callback` |
| Scopes | `scrape:read scrape:write account:read offline_access` |

The loopback port changes on every login. Validate the scheme, literal host,
and path exactly while allowing any valid ephemeral port. Do not accept
`localhost`, a non-loopback host, another path, a fragment, or wildcard query
parameters for this client.

The CLI intentionally has no client secret. A secret distributed in an npm
package cannot authenticate a public client.

## Required endpoints

The production defaults below can be overridden in the CLI with environment
variables for staging and local tests.

### 1. Authorization endpoint

```text
GET https://app.mrscraper.com/oauth/authorize
```

The CLI sends:

```text
response_type=code
client_id=mrscraper-cli
redirect_uri=http://127.0.0.1:{port}/oauth/callback
code_challenge={base64url-sha256-challenge}
code_challenge_method=S256
state={random-state}
scope=scrape:read scrape:write account:read offline_access
```

The endpoint must:

1. authenticate the user with the existing MrScraper web account;
2. resume this authorization request after login without losing its values;
3. validate the client, redirect URI, requested scopes, and `S256` challenge;
4. obtain or record authorization according to the product's consent policy;
5. issue a short-lived, random, single-use authorization code bound to the
   user, client ID, exact redirect URI, scopes, and code challenge; and
6. redirect the browser to the loopback URI with the unchanged `state` and
   either `code` or an OAuth error.

Success:

```text
http://127.0.0.1:{port}/oauth/callback?code={one-time-code}&state={same-state}
```

User denial or another authorization error:

```text
http://127.0.0.1:{port}/oauth/callback?error=access_denied&error_description={safe-message}&state={same-state}
```

Authorization codes should expire within one to two minutes. Store only a hash
of each code and mark it consumed atomically during exchange.

### 2. Token endpoint

```text
POST https://api.app.mrscraper.com/oauth/token
Content-Type: application/x-www-form-urlencoded
```

Authorization-code exchange request:

```text
grant_type=authorization_code
client_id=mrscraper-cli
code={one-time-code}
redirect_uri=http://127.0.0.1:{same-port}/oauth/callback
code_verifier={pkce-verifier}
```

Validate that the code is unused, unexpired, and bound to all supplied values.
Verify `BASE64URL(SHA256(code_verifier))` against its saved challenge, then
consume the code in the same transaction that creates the session.

Successful response:

```json
{
  "access_token": "opaque-or-signed-access-token",
  "refresh_token": "random-refresh-token",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "scrape:read scrape:write account:read offline_access"
}
```

The CLI requires `access_token`, `refresh_token`, a positive numeric
`expires_in`, and bearer token type on initial login.

Refresh request:

```text
grant_type=refresh_token
client_id=mrscraper-cli
refresh_token={current-refresh-token}
```

Return the same JSON shape. Rotate the refresh token on every successful use,
invalidate the previous token atomically, and retain the session's granted
scopes. The CLI serializes refreshes from parallel local processes and saves a
newly returned refresh token. A refresh response may technically omit
`refresh_token`, but the backend should always return the rotated value.

Token errors must be non-2xx JSON responses using OAuth error names such as
`invalid_request`, `invalid_client`, `invalid_grant`, or `invalid_scope`:

```json
{
  "error": "invalid_grant",
  "error_description": "The authorization grant is invalid or expired."
}
```

Do not include raw codes or tokens in error descriptions.

### 3. Revocation endpoint

```text
POST https://api.app.mrscraper.com/oauth/revoke
Content-Type: application/x-www-form-urlencoded
```

The CLI sends:

```text
client_id=mrscraper-cli
token={refresh-token}
token_type_hint=refresh_token
```

Revoke the complete refresh-token family and its active access tokens. Return
HTTP 200 for an already invalid or unknown token so logout is idempotent. The
CLI removes its local credentials even when this request fails.

## Resource-server changes

OAuth bearer access tokens must work on every API origin currently used by the
CLI:

- `https://api.app.mrscraper.com/api/v1`
- `https://api.mrscraper.com`
- `https://sync.scraper.mrscraper.com`

All three services, or their shared gateway, must validate the access token,
its expiry, issuer, audience, subject/account, revocation state when applicable,
and required scopes. They must map the OAuth subject to the same account,
subscription, quota, and audit context used for API keys.

The CLI sends OAuth credentials only as:

```http
Authorization: Bearer {oauth-access-token}
```

It sends legacy API keys as both `Authorization: Bearer` and `x-api-token` for
backward compatibility. Route requests with `x-api-token` through existing
API-key validation; route bearer-only requests through OAuth validation. Do not
require `x-api-token` for OAuth.

Return:

- `401 Unauthorized` with `WWW-Authenticate: Bearer` for a missing, expired,
  revoked, malformed, or otherwise invalid access token; and
- `403 Forbidden` for a valid token that lacks the required scope.

The CLI automatically refreshes shortly before expiry. If an API returns 401,
it forces one refresh and retries the request once.

## Backend data and lifecycle

The authorization service needs durable records for:

- the public client and its redirect/scopes policy;
- hashed authorization codes with challenge, binding data, expiry, and
  consumed timestamp;
- OAuth sessions and refresh-token families, storing refresh tokens hashed;
- granted scopes, account/user identity, creation, activity, expiry, and
  revocation timestamps; and
- access-token identifiers or signing-key metadata needed for validation and
  revocation.

Recommended defaults are 10–15 minute access tokens, rotating refresh tokens,
a bounded refresh-session lifetime, and server-side revocation from account
security settings. If refresh-token reuse is detected, revoke the token family
and require a new login.

If access tokens are JWTs, publish and rotate signing keys, validate `iss`,
`aud`, `sub`, `exp`, `iat`, scopes, and an identifier such as `jti`, and provide
a revocation strategy. If they are opaque, all API services need reliable
introspection or a shared validation layer.

## Security and operations requirements

- Serve all non-loopback endpoints over TLS.
- Require PKCE `S256`; never accept `plain` for this client.
- Prevent authorization-code replay and refresh-token races atomically.
- Apply CSRF protection to the web login/approval UI. The CLI separately
  validates OAuth `state` in constant time.
- Return `Cache-Control: no-store` and `Pragma: no-cache` from token and
  revocation endpoints.
- Never put access or refresh tokens in URLs.
- Redact authorization codes, verifiers, access tokens, refresh tokens, and
  authorization headers from application logs, traces, analytics, error
  reporting, and support tooling.
- Rate-limit authorization, token, refresh, and revocation attempts. Alert on
  code replay, refresh-token reuse, and unusual refresh volume.
- Keep signing keys and any token pepper/encryption keys in managed secret
  storage with an explicit rotation procedure.
- Ensure browser error pages and OAuth error descriptions do not disclose
  account or token details.

The relevant standards are [OAuth for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252),
[PKCE (RFC 7636)](https://www.rfc-editor.org/rfc/rfc7636),
[Token Revocation (RFC 7009)](https://www.rfc-editor.org/rfc/rfc7009), and the
[OAuth 2.0 Security Best Current Practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700).

## Deployment configuration

Use the CLI's environment overrides against staging before changing production
defaults:

```bash
export MRSCRAPER_OAUTH_AUTHORIZE_URL="https://staging-app.example/oauth/authorize"
export MRSCRAPER_OAUTH_TOKEN_URL="https://staging-api.example/oauth/token"
export MRSCRAPER_OAUTH_REVOKE_URL="https://staging-api.example/oauth/revoke"
export MRSCRAPER_OAUTH_CLIENT_ID="mrscraper-cli-staging"
export MRSCRAPER_OAUTH_SCOPE="scrape:read scrape:write account:read offline_access"
mrscraper login
```

These variables are deployment/test controls, not a user-facing way to add an
untrusted identity provider.

## Backend acceptance checklist

- A logged-out browser can sign in and return to the loopback callback.
- A logged-in browser can authorize without losing the original OAuth request.
- A valid PKCE code exchanges once; reuse, expiry, a wrong verifier, redirect,
  or client ID returns `invalid_grant`.
- Refresh rotates the token, preserves scopes, and rejects reuse of the old
  token.
- Revocation is idempotent and invalidates the complete session.
- OAuth bearer-only requests work on all three CLI API origins.
- Existing API-key requests still work unchanged.
- Invalid/expired access tokens return 401; insufficient scope returns 403.
- No code, verifier, or token value appears in logs, traces, or error payloads.
- End-to-end `login`, API use, automatic refresh, parallel CLI use, `status`,
  and `logout` pass in staging before production rollout.
