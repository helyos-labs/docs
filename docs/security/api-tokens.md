---
sidebar_position: 2
title: "API Tokens"
description: How Helyos authenticates REST API access with multi-user bearer tokens, from the first-run auto-generated token to named, revocable, Argon2id-hashed tokens.
---

# API Tokens

Every protected Helyos REST endpoint is guarded by a **bearer token**. The daemon issues one automatically on first start, accepts one you supply at launch, and can mint additional named tokens at runtime so each user or machine carries its own credential. This page covers where tokens come from, how they are stored, and how to create, inspect, and revoke them.

## How authentication works

Helyos splits its API into public and protected routes:

- **Public (no token):** `GET /health`, `GET /metrics`, `GET /api/v1/version`, `GET /api/v1/ca`.
- **Protected (Bearer token):** everything else — deployments, projects, secrets, nodes, routes, token management, and more.

To call a protected endpoint, send the token in an `Authorization: Bearer ...` header:

```bash
curl -H "Authorization: Bearer nxa-api_..." https://localhost:6443/api/v1/deployments
```

The `helyos` CLI does this for you: it reads a token from `--token`, the `HELYOS_API_TOKEN` environment variable, or the active context in `~/.helyos/config.toml`, in that order of precedence.

:::info
Tokens are an **authentication** mechanism, not fine-grained authorization. In v1 every valid token has the `admin` scope: the field is stored but not enforced. Treat any token as full access to the cluster.
:::

## The first-run token

When the daemon starts and no API token has been configured or stored, it generates one, persists only its hash, and logs the plaintext **exactly once**:

```text
Generated new API token — save this, it will not be shown again:
  HELYOS_API_TOKEN=nxa-api_3f9c...<64 hex chars>
```

:::danger
This is the only time the daemon will ever print this token. Copy it from the log immediately. Because Helyos stores only a hash, a lost token cannot be recovered — you would have to supply a new one with `--api-token` or mint a fresh named token from a machine that still has access.
:::

### Zero-config local use

On first start the daemon also writes a ready-to-use CLI context to `~/.helyos/config.toml` (unless that file already exists), so the local `helyos` CLI works immediately without you fishing the token out of the log. You typically only need the logged token to authenticate from **another** machine.

```bash
# Locally — just works, no setup:
helyos status

# From another machine, using the logged token:
helyos login https://your-cluster:6443 --token nxa-api_...
```

See [Remote access](/docs/guides/remote-access) for the full `helyos login` flow and [CLI config](/docs/reference/cli-config) for the context file format.

## Supplying your own token

Instead of letting the daemon generate one, you can pin a token at launch with `--api-token` or the `HELYOS_API_TOKEN` environment variable. The daemon hashes and stores it; the plaintext is never written to disk.

```bash
# Via flag:
helyosd --api-token nxa-api_your-own-secret

# Via environment variable:
export HELYOS_API_TOKEN=nxa-api_your-own-secret
helyosd
```

When you provide a token this way it is not echoed back in the log — the daemon only notes that a hash was stored.

:::note
Resolution order on the daemon side: a token from `--api-token`/`HELYOS_API_TOKEN` is hashed and persisted (overriding any stored hash); otherwise an existing stored hash is loaded; otherwise a fresh token is generated and logged once.
:::

## Token format

Helyos uses two distinct, easy-to-tell-apart token families:

| Kind | Prefix | Shape | Used for |
| --- | --- | --- | --- |
| API token | `nxa-api_` | `nxa-api_` + 64 hex chars (32 random bytes) | REST API bearer auth |
| Join token | `nxa_` | cluster join secret | Workers joining a [cluster](/docs/guides/clustering) |

If a secret starts with `nxa-api_` it is an API bearer token; if it starts with `nxa_` it is a cluster join token. They are not interchangeable.

## Argon2id hashing

Helyos never persists token plaintext. Each token is hashed with **Argon2id** (a memory-hard, salted password hash) and only the resulting PHC-format hash string is stored. On every authenticated request the daemon:

1. Computes the token's non-secret 12-character prefix (`nxa-api_` + 4 hex chars) and uses it as an indexed lookup, so it only ever runs a single Argon2 verification instead of scanning every row.
2. Verifies the presented token against the stored hash, rejecting expired tokens.
3. Records the matching token's identity on the request and throttled-updates its `last_used_at` timestamp.

:::tip
Because storage is one-way, a database leak does not expose usable tokens — an attacker would have to brute-force Argon2id hashes. This is also why tokens can only be shown at creation time.
:::

## Minting named tokens

For multi-user setups, mint a separate named token per person or machine so credentials can be revoked individually. The secret is returned **once** at creation and never again.

```bash
# Create a named token:
helyos auth token create ci-runner

# Create a token that expires after 1 hour (3600 seconds):
helyos auth token create deploy-bot --ttl 3600
```

Output includes the one-time secret and a ready-to-paste login command:

```text
Created API token 'ci-runner'

Token (shown once — save it now):
  nxa-api_8a2b...<64 hex chars>

Use it from another machine with:
  helyos login <server> --token nxa-api_8a2b...
```

The `--ttl` value is in **seconds**; omit it for a token that never expires. Under the hood this calls `POST /api/v1/tokens` with a JSON body of `{ "name": "...", "ttl_secs": N }`, and the response carries the `token`, `name`, `scope`, `created_at`, and `expires_at` fields. Token names must be unique — reusing an active name returns a conflict.

:::warning
Save the secret the moment it is shown. As with the first-run token, only the Argon2id hash is stored, so the plaintext cannot be retrieved later.
:::

## Listing tokens

List every token the daemon knows about. Secrets and hashes are never included — only metadata.

```bash
helyos auth token ls
```

```text
name            scope   expires               last used             revoked
ci-runner       admin   never                 2026-06-07T10:14:02Z  no
deploy-bot      admin   2026-06-07T11:00:00Z  never                 no
legacy-default  admin   never                 2026-06-07T09:58:31Z  no
```

The `legacy-default` row represents the first-run / supplied single token, surfaced so it appears in listings and can itself be revoked. `helyos auth token list` is an accepted alias for `ls`. Add `--json` for machine-readable output.

## Revoking tokens

Revoke a token by name. Revocation is a soft-delete — the row stays in the table (so it still appears in `ls` marked `revoked: yes`) but the token is rejected immediately on its next use.

```bash
helyos auth token revoke deploy-bot
```

This issues `DELETE /api/v1/tokens/{name}`. Revoking a name that has no active token returns a not-found error. Revoking `legacy-default` disables the original first-run/supplied token while leaving any named tokens working.

## Checking your identity: whoami

To confirm which token the CLI is using and that it is accepted, ask the server who you are:

```bash
helyos whoami
```

```text
name:  ci-runner
scope: admin
expires: 2026-06-07T11:00:00Z
last used: 2026-06-07T10:14:02Z
```

This calls `GET /api/v1/whoami` and reports the calling token's `name`, `scope`, and — when set — `expires_at` and `last_used_at`. It is the quickest way to verify a freshly configured token or context. Add `--json` for raw output.

## Good practices

- Mint a **distinct named token per user, CI job, or machine** rather than sharing one secret, so you can revoke access surgically.
- Use `--ttl` for short-lived automation credentials (CI, one-off deploys) so they expire on their own.
- Revoke tokens the moment they are no longer needed or may have leaked.
- Never commit tokens to source control; prefer `HELYOS_API_TOKEN` or a pinned [CLI context](/docs/reference/cli-config) over inline `--token` flags in scripts.
- Tokens are bearer credentials, so always carry them over HTTPS. See [TLS &amp; CA pinning](/docs/security/tls-ca-pinning).

## Next steps

- [Security model](/docs/security/security-model) — how tokens fit into Helyos' overall security posture.
- [TLS &amp; CA pinning](/docs/security/tls-ca-pinning) — protecting tokens in transit.
- [Remote access](/docs/guides/remote-access) — logging in and managing contexts from other machines.
- [CLI reference](/docs/reference/cli) and [REST API reference](/docs/reference/rest-api) — full command and endpoint listings.
