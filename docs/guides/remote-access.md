---
sidebar_position: 6
title: "Remote Access & Contexts"
description: Mint an API token, log in to a remote Helyos cluster with CA pinning, and switch between clusters using kubectl-style named contexts.
---

# Remote Access & Contexts

The `helyos` CLI follows a kubectl-style workflow for working with remote clusters: you mint an API token on the daemon, log in once to pin the daemon's CA and store the connection as a named **context**, then switch freely between clusters. This guide walks through tokens, login, identity, contexts, and logout.

When you install Helyos, the daemon writes a local CLI context to `~/.helyos/config.toml`, so the CLI already works against your local daemon with no setup. Everything below is about reaching daemons on *other* machines.

For a deeper treatment of the moving parts, see [API tokens](/docs/security/api-tokens) and [TLS & CA pinning](/docs/security/tls-ca-pinning).

## How a context works

A context bundles everything the CLI needs to talk to one daemon:

- `server` — the daemon URL, for example `https://cluster.example.com:6443`
- `token` — the API bearer token used for authentication
- `ca` / `ca-sha256` — the pinned self-signed CA and its SHA-256 fingerprint
- `project` — an optional default project for commands that take `-p`

Contexts live in `~/.helyos/config.toml` (override the path with `HELYOS_CONFIG`). The CLI manages this file for you through `helyos login` and `helyos context …`. See the [CLI config reference](/docs/reference/cli-config) for the full file format.

:::info Resolution precedence
For any command, the CLI resolves the server and token in this order: **CLI flag (`--server` / `--token`) > environment variable (`HELYOS_SERVER` / `HELYOS_API_TOKEN`) > config file (active context) > built-in default (`http://localhost:6443`)**. Use `--context <NAME>` to target a specific context for a single command.
:::

## 1. Mint an API token

The daemon auto-generates an API token on first run and logs it **once** (as `HELYOS_API_TOKEN=…`). For day-to-day remote access, mint named tokens you can track and revoke individually. Run this against a daemon you can already reach (locally, or through an existing context):

```bash
helyos auth token create alice
```

The secret is printed **once** — save it now, because the daemon only stores an Argon2id hash and can never show it again:

```text
✓ Created API token 'alice'

Token (shown once — save it now):
  nxa-api_3f9c...64-hex-chars...

Use it from another machine with:
  helyos login <server> --token nxa-api_3f9c...
```

Give a token a time-to-live with `--ttl` (in seconds); omit it for no expiry:

```bash
# A token that expires in one hour, ideal for CI
helyos auth token create ci --ttl 3600
```

List and revoke tokens by name:

```bash
helyos auth token ls          # alias: list
helyos auth token revoke ci
```

:::note
API tokens have the `nxa-api_` prefix followed by 64 hex characters. This is different from the cluster **join** token (prefix `nxa_`) used by workers to join a master — see [Clustering](/docs/guides/clustering).
:::

## 2. Log in to a remote cluster

`helyos login <server>` validates your token, pins the daemon's CA, and stores the result as a context. The CLI assumes `https://` and port `:6443` if you omit them, so `cluster.example.com` becomes `https://cluster.example.com:6443`.

```bash
helyos login cluster.example.com --token nxa-api_3f9c...
```

On success the token is checked against `GET /api/v1/whoami`, the CA is pinned, and the new context becomes active.

### CA pinning (trust on first use)

Helyos daemons serve a self-signed certificate by default. When you log in over HTTPS without a pinned CA, the CLI fetches the daemon's CA from the public `GET /api/v1/ca` endpoint and shows you its SHA-256 fingerprint to confirm:

```text
The server https://cluster.example.com:6443 presented a self-signed CA:
  SHA-256: 9f:86:d0:81:88:4c:7d:65:9a:2f:ea:a0:c5:5a:d0:15:...
Trust and pin this CA? [y/N]
```

Once you confirm, that CA is stored in the context and every future request to this cluster is verified against it. To verify the fingerprint out of band, ask a cluster operator to run `curl -sk https://cluster.example.com:6443/api/v1/ca` and compare the `sha256` field.

:::warning Interactive confirmation is required
Trust-on-first-use prompts only work on a terminal. In a non-interactive shell (CI, scripts), the CLI **refuses** to pin a CA without an explicit `--ca-fingerprint` or `--ca-file`. This is fail-closed by design — see the next section.
:::

### Login flags

| Flag | Description |
|---|---|
| `--token <TOKEN>` | API token (else `--token-stdin`, `$HELYOS_API_TOKEN`, or interactive prompt) |
| `--token-stdin` | Read the API token from stdin (one line) |
| `--ca-file <PEM>` | Trust this CA PEM file instead of fetching it out of band |
| `--ca-fingerprint <SHA256>` | Require the fetched CA to match this SHA-256, fail-closed with no prompt |
| `--insecure-skip-tls-verify` | Skip TLS verification entirely (insecure) |
| `--name <NAME>` | Context name (default: derived from the host) |
| `--project <NAME>` | Default project for this context |
| `--no-set-current` | Do not switch the active context to this one |

If you omit `--name`, the CLI derives a context name from the host (for example `https://helyos.acme.internal:6443` becomes `helyos-acme-internal`), and appends `-2`, `-3`, and so on if that name is taken.

### Non-interactive login (CI)

For automation, read the token from stdin and require an exact CA fingerprint so the login fails closed if the certificate does not match (a possible man-in-the-middle):

```bash
echo "$HELYOS_API_TOKEN" | helyos login https://cluster.example.com:6443 \
  --token-stdin \
  --ca-fingerprint 9f:86:d0:81:... \
  --name prod \
  --project web
```

The fingerprint comparison is forgiving about formatting — uppercase or lowercase, with or without colons, and an optional `sha256:` prefix all match.

Over HTTPS, `helyos login` always tries to fetch the daemon's self-signed CA from `/api/v1/ca`. If the daemon serves a **publicly trusted** certificate instead (so there is no self-signed CA to pin), that fetch fails and login asks you to either pass `--ca-file <pem>` with the chain you already have, or omit pinning altogether. To rely on the system trust store, skip `helyos login` and point a context straight at the daemon (`helyos context set <name> --server https://…`, or just `--server` / `$HELYOS_SERVER`): a context with no pinned CA is verified against the system roots automatically.

:::danger
`--insecure-skip-tls-verify` disables certificate verification completely and exposes your token to interception. Use it only against throwaway test daemons, never in production.
:::

## 3. Verify your identity

After logging in, confirm who you are and which context is active:

```bash
helyos whoami            # identity of the active token
helyos context current   # the active context
```

`helyos whoami` reports the calling token's identity from `GET /api/v1/whoami`:

```text
name:  alice
scope: admin
expires: 2026-07-01T12:00:00Z
last used: 2026-06-07T09:14:22Z
```

## 4. Manage multiple clusters

Each `helyos login` adds a context; switching between them is one command. The active context supplies the server, token, and pinned CA for every command unless you override them.

```bash
helyos context ls                  # list contexts (alias: list); * marks the active one
helyos context use prod            # switch the active context
helyos context current             # show the active context
helyos context rename prod prod-eu # rename a context
helyos context rm staging          # remove a context
```

`helyos context ls` shows the server, default project, and TLS mode for each context (`pinned`, `system`, `insecure`, or `http`):

```text
   name       server                                project   tls
 * prod       https://cluster.example.com:6443       web       pinned
   staging    https://staging.example.com:6443       -         pinned
   local      http://localhost:6443                  default   http
```

Edit a context's server URL or default project without re-logging in:

```bash
helyos context set prod --server https://new-host:6443 --project web
```

To run a single command against a different cluster without switching the active context, use the global `--context` flag:

```bash
helyos --context staging status
helyos --context staging pods -p web
```

:::tip
Set a default `project` on a context so you can drop the `-p`/`--project` flag from everyday commands like `pods`, `deployments`, `logs`, and `scale`. The context's project applies whenever you do not pass one explicitly.
:::

## 5. Log out

Logging out drops the token from a context but keeps the server URL and pinned CA, so you can re-log in with a single paste. It defaults to the active context:

```bash
helyos logout          # log out of the active context
helyos logout prod     # log out of a named context
```

To remove a context entirely (server, token, and pinned CA), use `helyos context rm <NAME>` instead.

## Editing the config by hand

The config file is human-readable TOML. The CLI manages it for you, but you can inspect or edit it directly:

```toml
# Managed by `helyos`. Edit with `helyos context` / `helyos login`.
current-context = "prod"

[context.local]
server = "http://localhost:6443"
token = "nxa-api_local"
project = "default"

[context.prod]
server = "https://cluster.example.com:6443"
token = "nxa-api_xxxxxxxx"
token-name = "alice"
project = "web"
ca = "<base64-encoded pinned CA PEM>"
ca-sha256 = "9f:86:d0:81:..."
```

The file is written atomically with `0600` permissions, and the previous version is backed up to `config.toml.bak` on each save. The full schema is documented in the [CLI config reference](/docs/reference/cli-config).

## Next steps

- [API tokens](/docs/security/api-tokens) — how tokens are minted, hashed, scoped, and revoked
- [TLS & CA pinning](/docs/security/tls-ca-pinning) — the daemon's TLS model and verifying fingerprints
- [Clustering](/docs/guides/clustering) — join workers to a master with the cluster join token
- [CLI reference](/docs/reference/cli) and [CLI config reference](/docs/reference/cli-config) — every command, flag, and config key
- [REST API reference](/docs/reference/rest-api) — the endpoints behind these commands
