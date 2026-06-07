---
sidebar_position: 1
title: "Security Model"
description: How Helyos secures its control plane out of the box — HTTPS by default, bearer-token auth, a hard cleartext guardrail, and a small set of public probe routes.
---

# Security Model

Helyos is **secure by default**. You do not opt into transport encryption or authentication — the daemon turns them on for you, and actively refuses the most dangerous misconfigurations. This page explains the posture so you understand what is protected, what is intentionally public, and where the guardrails are.

The control plane has exactly two trust boundaries you need to reason about:

- The **REST API** on port `6443`, which the `helyos` CLI and any HTTP client use to manage the cluster.
- The **cluster gRPC channel** on port `6444`, which workers use to join a master.

Both are encrypted and authenticated by default. The rest of this page focuses on the REST API; clustering and secrets each have their own pages linked at the end.

## The three pillars

| Pillar | Default | Mechanism |
|---|---|---|
| Transport | HTTPS on any non-loopback bind | Auto-generated self-signed certificate |
| Authentication | Bearer token required on all resource routes | Argon2id-hashed API tokens |
| Cleartext exposure | Refused unless explicitly forced | `--tls off` + `--insecure-http` + a configured token |

## HTTPS: on by default, off only on loopback

The daemon's `--tls` flag has three values, and the default is `auto`:

| `--tls` value | Behaviour |
|---|---|
| `auto` (default) | HTTPS, **unless** the bind host is loopback (`127.0.0.1`, `localhost`, `::1`), in which case plain HTTP is used for local convenience. |
| `on` | Always HTTPS, even on loopback. |
| `off` | No TLS. On a non-loopback bind this is gated by the cleartext guardrail (see below). |

In other words, the moment you expose the daemon to the network — `--host 0.0.0.0`, a LAN IP, or a public address — it serves HTTPS automatically. You do not have to remember to turn it on.

```bash
# Local development: loopback bind → plain HTTP, zero config
helyosd

# Exposed to the network: non-loopback bind → HTTPS, self-signed cert auto-generated
helyosd --host 0.0.0.0 --advertise-addr cluster.example.com
```

On first start with TLS enabled, the daemon generates a self-signed certificate and stores it under the data directory. The certificate's SANs are derived from:

- the bind host (unless it is a wildcard like `0.0.0.0` or `::`),
- `--advertise-addr`,
- any `--tls-san` values you pass (repeatable),
- the system hostname.

You can also bring your own certificate with `--tls-cert` and `--tls-key`, which overrides the self-signed material entirely.

:::tip
Set `--advertise-addr` to the hostname your clients will actually dial. It is baked into the certificate SAN and printed in the `helyos login` hint, so remote clients connect cleanly without certificate-name mismatches.
:::

For the full TLS workflow — generating, pinning, and trusting the CA from the CLI — see [TLS & CA pinning](/docs/security/tls-ca-pinning).

## The plain-HTTP guardrail

Serving a non-loopback address in the clear is almost always a mistake, so Helyos refuses to do it by accident. To bind a reachable address over plain HTTP you must satisfy **all three** of these conditions:

1. `--tls off` — explicitly disable TLS.
2. `--insecure-http` — explicitly acknowledge the cleartext exposure.
3. An API token must be configured (via `--api-token`, `HELYOS_API_TOKEN`, or a previously generated token).

If you drop any one of them, the daemon exits with a clear error rather than starting:

```text
refusing to serve a non-loopback address (0.0.0.0) over plain HTTP;
use --tls on, or pass BOTH --tls off and --insecure-http
```

```text
refusing to expose a non-loopback address with no API token configured;
set --api-token / HELYOS_API_TOKEN first
```

:::danger
The guardrail exists to stop accidents, not to make cleartext safe. Even with all three conditions met, anyone on the network path can read your bearer token and every request. Only use `--insecure-http` on a trusted, isolated network — or better, don't: leave `--tls auto` and serve HTTPS.
:::

Loopback binds are never subject to the guardrail. Local development over plain HTTP on `127.0.0.1` always works with no flags.

## Authentication: bearer tokens on every resource route

Every route under `/api/v1/*` that touches a resource requires a bearer token in the `Authorization` header:

```bash
curl -sk https://localhost:6443/api/v1/deployments \
    -H "Authorization: Bearer $HELYOS_API_TOKEN"
```

On first run, the daemon generates an API token and logs it **once**:

```text
Generated new API token — save this, it will not be shown again:
  HELYOS_API_TOKEN=nxa-api_<64 hex chars>
```

Save it. You can also supply your own token up front via `--api-token` or the `HELYOS_API_TOKEN` environment variable. Tokens are never stored in plaintext — only their **Argon2id** hash is persisted, and authentication verifies the presented token against that hash.

Token facts at a glance:

- API token format: prefix `nxa-api_` followed by 64 hex characters (32 random bytes).
- Cluster join token format: prefix `nxa_` (a separate credential — see clustering).
- You can mint additional named tokens at runtime; each secret is shown exactly once.

:::tip
For local use you rarely need to copy the token at all. On first start the daemon writes a ready-to-use CLI context to `~/.helyos/config.toml`, so the `helyos` CLI works against the local daemon with zero setup. See [CLI configuration](/docs/reference/cli-config).
:::

Minting, listing, revoking, and TTLs for tokens are covered in detail on [API tokens](/docs/security/api-tokens).

## Public routes (no token required)

A small, deliberate set of routes is public so that a client can check reachability and establish trust **before** it has a token. These routes never return resource data or secrets:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/api/v1/version` | Daemon version / TLS reachability probe |
| `GET` | `/api/v1/ca` | Self-signed CA PEM + SHA-256 fingerprint, for pinning |

Everything else — deployments, projects, pods, secrets, nodes, routes, certificates, cluster config, token management, and the event stream — sits behind the bearer-token middleware.

The `/api/v1/ca` route is what makes secure remote onboarding possible: a fresh client can read the daemon's CA and its fingerprint over the wire, verify it out of band, then pin it for all future connections.

```bash
# Read the CA fingerprint to pin during login
curl -sk https://cluster.example.com:6443/api/v1/ca
```

## Threat-model notes

A few things worth being explicit about:

- **Cleartext leaks everything.** Bearer tokens are sent in a header. Over plain HTTP that token, and every request and response, is readable by anyone on the path. This is the entire reason for the cleartext guardrail. Treat `--insecure-http` as a footgun.
- **Public routes are intentionally unauthenticated.** `/health`, `/metrics`, `/api/v1/version`, and `/api/v1/ca` reveal that a daemon exists, its version, and its CA. The CA is public information; pinning it protects you against impersonation, not disclosure. If `/metrics` exposure is a concern, restrict it at the network layer.
- **Self-signed by default means you must pin.** A self-signed certificate is encrypted but not trusted by any CA. Without pinning the CA fingerprint, a client that blindly accepts the certificate (e.g. `curl -k`) is vulnerable to a man-in-the-middle. Pin the CA via `helyos login --ca-fingerprint` for production access. See [TLS & CA pinning](/docs/security/tls-ca-pinning).
- **Tokens are bearer credentials.** Anyone holding a valid token has the access that token grants. Store them like passwords, prefer per-user named tokens with TTLs over sharing one secret, and revoke promptly. In v1 all tokens carry the `admin` scope — scope is recorded but not yet enforced.
- **The plaintext token is shown once.** If you lose a generated token, you cannot recover it from the daemon (only the hash is stored). Mint a new named token instead.
- **Cluster auth is separate.** Workers authenticate to the master with a join token, not a client certificate, over server-authenticated TLS. The REST API bearer token and the cluster join token are different credentials with different lifecycles.
- **Secrets are encrypted at rest.** Application secrets are stored with AES-256-GCM using a per-node master key, never in plaintext. See [Secrets encryption](/docs/security/secrets-encryption).

## See also

- [API tokens](/docs/security/api-tokens) — mint, list, revoke, and scope bearer tokens.
- [TLS & CA pinning](/docs/security/tls-ca-pinning) — generate, fetch, and pin the daemon CA.
- [Secrets encryption](/docs/security/secrets-encryption) — how application secrets are protected at rest.
- [Remote access](/docs/guides/remote-access) — log in to a daemon from another machine.
- [Daemon flags](/docs/reference/daemon-flags) — every `helyosd` flag, including the full TLS and auth options.
- [REST API](/docs/reference/rest-api) — the complete route list with auth requirements.
