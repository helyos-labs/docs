---
sidebar_position: 4
title: "helyosd Flags"
description: Complete reference for every helyosd command-line flag, grouped by purpose, with defaults and behavior.
---

# helyosd Flags

`helyosd` is the Helyos daemon. This page documents every command-line flag it accepts, grouped by purpose, with each flag's default value and behavior. Flags are passed when you start the daemon:

```bash
helyosd [OPTIONS]
```

You can always print the live list with `helyosd --help` and the build version with `helyosd --version`.

:::tip
For local use you usually do not need any flags. On first start `helyosd` generates an API token, optionally writes a self-signed certificate, and seeds a ready-to-use local CLI context at `~/.helyos/config.toml`, so the `helyos` CLI works out of the box. See [Installation](/docs/getting-started/installation).
:::

## Core

These flags control the basics: where the daemon listens, where it stores data, what mode it runs in, and which container runtime it drives.

| Flag | Default | Description |
|---|---|---|
| `--host <HOST>` | `127.0.0.1` | Address the REST API binds to. Use `0.0.0.0` to listen on all interfaces. A loopback bind (`127.0.0.1`, `localhost`, `::1`) keeps the API as plain HTTP under the default `--tls auto`. |
| `--port <PORT>` | `6443` | Port for the REST API (HTTP or HTTPS depending on the TLS mode). |
| `--data-dir <DIR>` | `~/.helyos/data` | Directory for the SQLite databases (`helyos.db`, `secrets.db`, `routes.db`), the master encryption key, and generated TLS material. Falls back to `/var/lib/helyos` if no home directory is detectable. |
| `--mode <MODE>` | `single` | Node mode: `single` (standalone), `master` (cluster control plane), or `worker` (joins a master). See [Clustering](/docs/guides/clustering). |
| `--runtime <RUNTIME>` | `auto` | Container runtime: `docker`, `containerd`, or `auto` (detect, preferring Docker). |

```bash
# Listen on all interfaces, store data under /var/lib/helyos
helyosd --host 0.0.0.0 --port 6443 --data-dir /var/lib/helyos --runtime auto
```

:::info
Logging verbosity is controlled by the standard `RUST_LOG` environment variable (default level `info`), not a flag. For example: `RUST_LOG=debug helyosd`.
:::

## Security / API access

These flags govern HTTPS for the REST API and the bearer token required to call it. See [Security model](/docs/security/security-model), [API tokens](/docs/security/api-tokens), and [TLS & CA pinning](/docs/security/tls-ca-pinning).

| Flag | Default | Description |
|---|---|---|
| `--tls <MODE>` | `auto` | TLS mode for the REST API: `auto` (HTTPS unless bound to loopback), `on` (always HTTPS), or `off` (plain HTTP). |
| `--tls-cert <PATH>` | _(none)_ | Path to a PEM certificate to serve instead of the auto-generated self-signed one. Must be paired with `--tls-key`. |
| `--tls-key <PATH>` | _(none)_ | Path to the PEM private key for `--tls-cert`. |
| `--tls-san <SAN>` | _(none)_ | Extra Subject Alternative Name (DNS name or IP) to bake into the self-signed certificate. Repeatable. |
| `--advertise-addr <ADDR>` | _(none)_ | Public address clients dial. It is added to the certificate SANs and printed in the `helyos login` hint. Defaults to `--host` when unset. |
| `--insecure-http` | `false` | Allow binding a non-loopback address over plain HTTP. Only takes effect together with `--tls off`. |
| `--api-token <TOKEN>` | _(auto-generated)_ | API bearer token. Can also be set via the `HELYOS_API_TOKEN` environment variable. If omitted, the stored token is reused, or a fresh one is generated and logged once. |

### How TLS resolves

With the default `--tls auto`, the daemon serves **HTTPS** unless the bind host is a loopback address, in which case it serves plain **HTTP** for local convenience. You can force the behavior with `--tls on` or `--tls off`.

When HTTPS is enabled and no `--tls-cert`/`--tls-key` is supplied, `helyosd` generates a self-signed certificate on first start. Its SANs are derived from the bind `--host` (unless it is `0.0.0.0`/`::`), `--advertise-addr`, every `--tls-san` value, and the system hostname. The certificate and its CA are stored under `--data-dir`.

```bash
# Public daemon with HTTPS and a stable advertised name
helyosd --host 0.0.0.0 --advertise-addr cluster.example.com --tls on

# Bring your own certificate instead of the self-signed one
helyosd --host 0.0.0.0 --tls on \
    --tls-cert /etc/helyos/tls/server.crt \
    --tls-key  /etc/helyos/tls/server.key
```

:::danger
A non-loopback bind over plain HTTP is **refused** unless you pass **both** `--tls off` and `--insecure-http`, and even then only if an API token is configured (`--api-token` / `HELYOS_API_TOKEN`). This guardrail prevents accidentally exposing an unauthenticated, unencrypted control plane.
:::

:::warning
The API bearer token is generated and logged **only once** on first run, as a line like `HELYOS_API_TOKEN=...`. Save it. Tokens are stored as Argon2id hashes, so the plaintext is never recoverable from disk. You can mint additional named tokens at runtime via the REST API or the [CLI](/docs/reference/cli) `helyos auth token create`.
:::

## Clustering

These flags configure multi-node operation. They apply in `master` and `worker` modes (set with `--mode`). See [Clustering](/docs/guides/clustering).

| Flag | Default | Description |
|---|---|---|
| `--join <ADDR>` | _(none)_ | Master gRPC address to join, for example `10.0.1.1:6444`. Required in `worker` mode. |
| `--token <TOKEN>` | _(none)_ | Join token presented to the master. Required in `worker` mode. |
| `--grpc-port <PORT>` | `6444` | Port for cluster gRPC traffic (master serves on it; worker listens on it). |

Cluster gRPC traffic runs over TLS: the master serves a self-signed certificate signed by a CA it generates, and workers verify the master against that CA. Workers authenticate to the master with the **join token**, not a client certificate.

```bash
# Master (control plane)
helyosd --mode master --host 0.0.0.0 --grpc-port 6444

# The master logs the exact join command, e.g.:
#   helyosd --mode worker --join 10.0.1.1:6444 --token nxa_...

# Worker
helyosd --mode worker --join 10.0.1.1:6444 --token nxa_...
```

:::note
The join token uses the `nxa_` prefix. It is distinct from API bearer tokens (prefix `nxa-api_`). Show or rotate the join token at runtime with the [CLI](/docs/reference/cli): `helyos cluster token show` / `helyos cluster token rotate`.
:::

## DNS

These flags control service discovery via the embedded DNS server. See [Service discovery](/docs/concepts/service-discovery).

| Flag | Default | Description |
|---|---|---|
| `--dns-mode <MODE>` | `noop` | DNS mode: `noop` (single-node; containers use Docker's DNS) or `embedded` (run the built-in Hickory DNS server for multi-node service discovery). |
| `--dns-listen <ADDR>` | `127.0.0.1:15353` | Listen address for the embedded DNS server (used only with `--dns-mode embedded`). |
| `--dns-upstream <ADDR>` | `8.8.8.8:53` | Upstream resolver for forwarding queries that are not `*.internal`. |
| `--master-ip <IP>` | _(none)_ | IP address of this node, written into container DNS configuration so pods can reach the embedded resolver. Used in `embedded` mode. |

With `--dns-mode embedded`, the daemon resolves `<deployment>.<project>.internal` (and per-pod `<deployment>-<n>.<project>.internal`) and forwards everything else to `--dns-upstream`.

```bash
# Embedded DNS for a multi-node cluster
helyosd --mode master --dns-mode embedded --master-ip 10.0.1.1
```

## Proxy / networking

These flags configure the built-in reverse proxy, automatic route TLS, and the experimental overlay network. See [Routing](/docs/guides/routing), [TLS](/docs/guides/tls), and [Networking](/docs/guides/networking).

| Flag | Default | Description |
|---|---|---|
| `--proxy-backend <BACKEND>` | `traefik` | Reverse-proxy backend: `traefik`, `nginx`, or `caddy`. Any unrecognized value falls back to `traefik`. |
| `--proxy-config-dir <DIR>` | `<data-dir>/proxy` | Directory where the proxy backend's generated configuration is written. |
| `--acme-email <EMAIL>` | _(none)_ | Email used for ACME (Let's Encrypt) certificate issuance. Setting it enables automatic TLS for public routes with daily renewal. |
| `--cluster-cidr <CIDR>` | `172.20.0.0/16` | CIDR block for the overlay network's subnet allocation. |
| `--wg-port <PORT>` | `51820` | WireGuard listen port for the overlay network. |
| `--overlay` | `false` | Enable the WireGuard overlay network. |

```bash
# Use nginx as the proxy backend and enable ACME for public routes
helyosd --proxy-backend nginx --acme-email ops@example.com
```

:::warning Experimental
The WireGuard overlay (`--overlay`, `--cluster-cidr`, `--wg-port`) is **experimental and not production-ready**. Tunnel creation is not yet implemented; the daemon currently only logs overlay activity. CNI plugin support (installed separately via `helyos setup cni`) is likewise experimental.
:::

## Environment variables

A few flags can also be supplied through the environment:

| Variable | Equivalent flag | Description |
|---|---|---|
| `HELYOS_API_TOKEN` | `--api-token` | API bearer token for the REST API. |
| `RUST_LOG` | _(none)_ | Log filter (e.g. `info`, `debug`, `helyosd=debug`). Defaults to `info`. |

## Modes at a glance

| `--mode` | Purpose | Required flags | Common extras |
|---|---|---|---|
| `single` | Standalone daemon (default) | — | `--host`, `--port`, `--tls` |
| `master` | Cluster control plane | — | `--grpc-port`, `--dns-mode embedded`, `--master-ip` |
| `worker` | Joins a master | `--join`, `--token` | `--grpc-port`, `--overlay` |

## See also

- [Installation](/docs/getting-started/installation) — install and start the daemon
- [CLI reference](/docs/reference/cli) — the `helyos` client and its commands
- [CLI config](/docs/reference/cli-config) — how the CLI stores contexts and tokens
- [REST API](/docs/reference/rest-api) — the endpoints `helyosd` exposes
- [Security model](/docs/security/security-model) and [TLS & CA pinning](/docs/security/tls-ca-pinning)
- [Clustering](/docs/guides/clustering) — run master and worker nodes
