---
sidebar_position: 5
title: "CLI Configuration & Contexts"
description: How the helyos CLI resolves its server and token, and the format of the ~/.helyos/config.toml contexts file.
---

# CLI Configuration & Contexts

The `helyos` CLI connects to a `helyosd` daemon over HTTPS using a bearer token. It remembers each connection as a named **context** -- a server URL, token, default project, and (for remote clusters) a pinned CA. This page documents the on-disk config file format, the environment variables, and the exact precedence the CLI uses to pick a server and token for every command.

In day-to-day use you rarely edit this file by hand: `helyosd` writes a local context on first start, and `helyos login` / `helyos context` manage remote ones. But the format is human-readable, and understanding the resolution rules makes scripting and CI predictable.

:::tip
For the commands that manage contexts (`helyos login`, `helyos context`, `helyos logout`, `helyos whoami`), see the [CLI reference](/docs/reference/cli). For the end-to-end remote workflow, see the [Remote access guide](/docs/guides/remote-access).
:::

## The config file

Contexts live in a single TOML file. Its location is, in order:

1. The path in the `HELYOS_CONFIG` environment variable, if set and non-empty.
2. Otherwise `~/.helyos/config.toml`.

The file uses a small TOML subset: a top-level `current-context` key plus one `[context.NAME]` section per target. Comments (`#`), blank lines, and quoted or unquoted values are all accepted.

```toml
# Managed by `helyos`. Edit with `helyos context` / `helyos login`.
current-context = "prod"

[context.local]
server = "http://localhost:6443"
token = "nxa-api_local0000000000000000000000000000000000000000000000000000000000"
project = "default"

[context.prod]
server = "https://cluster.example.com:6443"
token = "nxa-api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
token-name = "alice"
project = "web"
ca = "<base64-encoded pinned CA PEM>"
ca-sha256 = "9f:86:d0:81:88:4c:7d:65:9a:2f:ea:a0:c5:5a:d0:15:..."
insecure = false
```

### Top-level keys

| Key | Type | Description |
|---|---|---|
| `current-context` | string | Name of the active context. Optional -- see [Choosing the active context](#choosing-the-active-context). |

### Per-context keys

Each `[context.NAME]` section accepts the following keys. Only `server` is required; the rest are optional and unknown keys are ignored.

| Key | Type | Written by | Description |
|---|---|---|---|
| `server` | string (required) | `login`, `context set` | Daemon URL, e.g. `https://host:6443`. |
| `token` | string | `login` | API bearer token (prefix `nxa-api_`). |
| `token-name` | string | `login` | Friendly name of the token, as reported by the daemon. |
| `project` | string | `login --project`, `context set --project` | Default project for commands run in this context. |
| `insecure` | bool (`true`/`false`) | `login --insecure-skip-tls-verify` | Skip TLS verification for this context. |
| `ca` | string (base64) | `login` | Base64-encoded PEM of the daemon's pinned CA (trust-on-first-use). |
| `ca-sha256` | string | `login` | SHA-256 fingerprint of the pinned CA. |

:::warning
A context with `insecure = true` disables TLS verification entirely for that connection, which exposes you to man-in-the-middle attacks. Prefer pinning the CA (the default `helyos login` behaviour) over `--insecure-skip-tls-verify`. See [TLS & CA pinning](/docs/security/tls-ca-pinning).
:::

## Environment variables

Three environment variables affect CLI configuration:

| Variable | Effect |
|---|---|
| `HELYOS_CONFIG` | Overrides the path to the config file (default `~/.helyos/config.toml`). |
| `HELYOS_SERVER` | Supplies the server URL when `--server` is not passed. |
| `HELYOS_API_TOKEN` | Supplies the API token when `--token` is not passed. |

```bash
# Point the CLI at a daemon for one shell session, no config file needed
export HELYOS_SERVER=https://10.0.1.1:6443
export HELYOS_API_TOKEN=nxa-api_xxxxxxxx
helyos status
```

:::note
`HELYOS_API_TOKEN` is the same variable `helyosd` prints (once) on first start and accepts via `--api-token`. You can pipe it straight into `helyos login --token-stdin` for CI. See [API tokens](/docs/security/api-tokens).
:::

## Resolution precedence

For every command, the CLI resolves the **server** and **token** independently, each using this order (first match wins):

1. **CLI flag** -- `--server` / `--token`.
2. **Environment variable** -- `HELYOS_SERVER` / `HELYOS_API_TOKEN`. (clap merges the flag and env var, so by the time resolution runs these two are already collapsed into one value.)
3. **Active context** -- the `server` / `token` of the selected context in the config file.
4. **Built-in default** -- for the server only: `http://localhost:6443`. There is no built-in default token (an unauthenticated request is sent if none resolves).

```bash
# Flag beats everything else for this one command
helyos --server https://10.0.1.1:6443 --token "$TOKEN" status

# No flags, no env: falls back to the active context, then to http://localhost:6443
helyos status
```

The context's `project`, `ca`, and `insecure` settings are taken from the active context as well -- there are no flags or env vars that override `ca` or `insecure` per command (use `--context` to switch to a different context, or re-run `helyos login`).

:::info
When the resolved server is plain `http://` and is **not** the loopback default (`http://localhost:6443` or `http://127.0.0.1:6443`), the CLI prints a warning that tokens and secrets may travel unencrypted. Use an `https://` server for anything beyond local development.
:::

## Choosing the active context

The `--context NAME` flag selects a context explicitly for a single command. If the named context does not exist, the command fails.

```bash
helyos --context staging status
```

When `--context` is **not** passed, the active context is chosen as follows:

1. If `current-context` is set **and** that context exists, it is used.
2. Otherwise, if there is **exactly one** context defined, that single context is used implicitly.
3. Otherwise, there is no active context -- the CLI falls back to env vars / flags / the built-in default.

This means a config file with a single context "just works" without ever setting `current-context`, while a file with several contexts requires either `current-context` or an explicit `--context`.

```bash
helyos context current   # print the active context name and its server
helyos context use prod  # set current-context = "prod"
```

## How the file is written

The CLI never edits the file in place. On every save (`login`, `logout`, `context use/set/rename/rm`):

1. If a file already exists at the target path, it is first copied to `config.toml.bak` (the previous version is always recoverable).
2. The new content is written to a temporary file in the same directory.
3. That temp file is set to `0600` permissions (owner read/write only, on Unix).
4. The temp file is atomically renamed over the real path.

This atomic-rename strategy means an interrupted save never leaves a truncated or half-written config.

:::tip
If you ever corrupt the file by hand, restore it with `cp ~/.helyos/config.toml.bak ~/.helyos/config.toml`. The CLI tolerates a missing or unreadable file -- it simply behaves as if no contexts are defined (and prints a warning if the file exists but cannot be read).
:::

## Legacy flat files

Earlier setups used a flat config with top-level `server` / `token` keys and no `[context.*]` sections:

```toml
# Legacy format (still supported on read)
server = "http://localhost:6443"
token = "nxa-api_xxxxxxxx"
```

Such a file is read as a single implicit context named `default`, so existing configurations keep working without any migration. The next time the CLI writes the file (for example after `helyos login` or `helyos context use`), it is rewritten into the current `[context.NAME]` format.

## Editing by hand vs. the CLI

You can edit `~/.helyos/config.toml` directly -- it is plain TOML and the parser ignores unknown keys and sections. In practice, prefer the managed commands so values like the pinned CA stay consistent:

```bash
helyos login https://cluster.example.com:6443 --token nxa-api_xxxx --name prod --project web
helyos context set prod --server https://new-host:6443 --project api
helyos context rename prod prod-eu
helyos logout prod      # drops the token but keeps server + pinned CA
helyos context rm prod
```

When the CLI rewrites the file it preserves only the **known** keys listed above; any custom keys or comments you added by hand are dropped on the next save.

## Worked example: multi-cluster setup

```toml
# ~/.helyos/config.toml
current-context = "staging"

[context.local]
server = "http://localhost:6443"
project = "default"

[context.staging]
server = "https://staging.internal:6443"
token = "nxa-api_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
token-name = "ci-bot"
project = "web"
ca = "<base64-encoded staging CA PEM>"
ca-sha256 = "1a:2b:3c:..."

[context.prod]
server = "https://prod.example.com:6443"
token = "nxa-api_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
token-name = "alice"
project = "web"
ca = "<base64-encoded prod CA PEM>"
ca-sha256 = "9f:86:d0:..."
```

With this file:

```bash
helyos status                       # uses staging (current-context)
helyos --context prod status        # one-off against prod
helyos context use prod             # make prod the default going forward
HELYOS_SERVER=http://localhost:6443 helyos pods   # env overrides the active context's server
```

## See also

- [CLI reference](/docs/reference/cli) -- every command and flag, including `login`, `logout`, `whoami`, and `context`.
- [Remote access guide](/docs/guides/remote-access) -- log in to a remote cluster end to end.
- [API tokens](/docs/security/api-tokens) -- minting, listing, and revoking the tokens stored in contexts.
- [TLS & CA pinning](/docs/security/tls-ca-pinning) -- how `ca` / `ca-sha256` protect remote connections.
- [Daemon flags](/docs/reference/daemon-flags) -- how `helyosd` exposes the API the CLI connects to.
