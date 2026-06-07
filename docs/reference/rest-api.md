---
sidebar_position: 3
title: "REST API"
description: Complete endpoint reference for the helyosd REST API — public and Bearer-protected routes, the Authorization header, and the token-mint, whoami, and CA pinning flows.
---

# REST API

`helyosd` exposes a versioned REST API that the `helyos` CLI — and any HTTP client you write — uses to manage projects, deployments, pods, nodes, routes, and tokens. This page is the complete endpoint reference: every route, its HTTP method, whether it needs authentication, and what it does.

If you mostly use the CLI, you rarely touch the API directly. But the API is the contract behind every command, and knowing it makes scripting, automation, and debugging straightforward.

## Base URL and port

The API listens on port `6443` by default (override with the daemon's `--port` flag). All resource endpoints are namespaced under `/api/v1/`.

Whether you reach it over `https://` or `http://` depends on the TLS mode:

- **HTTPS by default.** With the default `--tls auto`, the daemon serves HTTPS on any non-loopback bind and generates a self-signed certificate on first start.
- **Plain HTTP on loopback.** When bound to a loopback address (`127.0.0.1`), `auto` keeps the API on plain HTTP for local convenience.

So a typical local base URL is `http://localhost:6443`, and a typical remote base URL is `https://cluster.example.com:6443`.

:::info
Because the daemon uses a self-signed certificate by default, plain `curl` against an HTTPS endpoint fails certificate verification. Either pin the CA (see [CA pinning](#the-ca-pinning-flow) below) or use `curl -k` for quick local testing. For details on the TLS model, see [Automatic TLS](/docs/guides/tls) and [TLS & CA pinning](/docs/security/tls-ca-pinning).
:::

## Authentication

Every route under `/api/v1/` is protected with a Bearer token, **except** `version` and `ca`, which are public so a client can probe reachability and pin the CA before it has a token. The two public non-versioned routes `/health` and `/metrics` are also unauthenticated.

Send the token in the standard `Authorization` header:

```http
Authorization: Bearer <token>
```

For example, with `curl`:

```bash
curl -sk https://localhost:6443/api/v1/whoami \
    -H "Authorization: Bearer $HELYOS_API_TOKEN"
```

API tokens have the prefix `nxa-api_` followed by 64 hex characters. The daemon generates one on first run and logs it once as `HELYOS_API_TOKEN=...`; you can also supply your own via the `--api-token` flag or the `HELYOS_API_TOKEN` environment variable. Tokens are stored as Argon2id hashes — the plaintext is never persisted.

A request with a missing or invalid token receives:

```json
{ "error": "missing or invalid bearer token" }
```

with HTTP status `401 Unauthorized`.

:::note
If the daemon is started with **no** API token configured at all, the Bearer middleware passes requests through unauthenticated. This is intended only for local development. A non-loopback bind requires a token. For the full security model, see [API tokens](/docs/security/api-tokens) and [Security model](/docs/security/security-model).
:::

## Public endpoints

These routes never require authentication.

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/health` | none | Liveness / health check |
| `GET` | `/metrics` | none | Prometheus metrics |
| `GET` | `/api/v1/version` | none | Daemon version and TLS reachability probe |
| `GET` | `/api/v1/ca` | none | Self-signed CA PEM and SHA-256 fingerprint (for pinning) |

## Bearer-protected endpoints

Every route below requires a valid `Authorization: Bearer <token>` header.

### Identity and tokens

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/v1/whoami` | Bearer | Identity of the calling token |
| `POST` | `/api/v1/tokens` | Bearer | Mint a named API token (secret shown once) |
| `GET` | `/api/v1/tokens` | Bearer | List API tokens (never the secret) |
| `DELETE` | `/api/v1/tokens/{name}` | Bearer | Revoke an API token by name |

### Projects

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/v1/projects` | Bearer | List projects |
| `POST` | `/api/v1/projects` | Bearer | Create a project |
| `POST` | `/api/v1/projects/{name}/suspend` | Bearer | Suspend a project (stops its deployments) |
| `POST` | `/api/v1/projects/{name}/resume` | Bearer | Resume a suspended project |
| `DELETE` | `/api/v1/projects/{name}` | Bearer | Delete a project |

### Deployments and pods

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `POST` | `/api/v1/deploy` | Bearer | Deploy from a spec |
| `GET` | `/api/v1/deployments` | Bearer | List deployments |
| `POST` | `/api/v1/projects/{p}/deployments/{d}/scale` | Bearer | Scale a deployment |
| `POST` | `/api/v1/projects/{p}/deployments/{d}/stop` | Bearer | Stop a deployment |
| `DELETE` | `/api/v1/projects/{p}/deployments/{d}` | Bearer | Remove a deployment |
| `GET` | `/api/v1/projects/{p}/deployments/{d}/logs` | Bearer | Stream deployment logs |
| `GET` | `/api/v1/pods` | Bearer | List pods |

### Secrets

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/v1/projects/{p}/secrets` | Bearer | List a project's secret names |
| `POST` | `/api/v1/projects/{p}/secrets/{n}` | Bearer | Set a secret |
| `DELETE` | `/api/v1/projects/{p}/secrets/{n}` | Bearer | Delete a secret |

### Nodes and events

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/v1/nodes` | Bearer | List nodes |
| `GET` | `/api/v1/nodes/stats` | Bearer | Node resource stats |
| `POST` | `/api/v1/nodes/{name}/drain` | Bearer | Drain a node |
| `DELETE` | `/api/v1/nodes/{name}` | Bearer | Remove a node |
| `GET` | `/api/v1/events` | Bearer | Cluster event stream (Server-Sent Events) |

### Routes and certificates

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/v1/routes` | Bearer | List routes |
| `POST` | `/api/v1/routes` | Bearer | Add a route |
| `DELETE` | `/api/v1/routes/{domain}` | Bearer | Remove a route by domain |
| `POST` | `/api/v1/certs/import` | Bearer | Import a TLS certificate |

### Cluster and configuration

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `POST` | `/api/v1/cluster/init` | Bearer | Initialize the cluster |
| `GET` | `/api/v1/cluster/token` | Bearer | Show the cluster join token |
| `POST` | `/api/v1/cluster/token/rotate` | Bearer | Rotate the cluster join token |
| `GET` | `/api/v1/cluster/scheduler` | Bearer | Get scheduler config |
| `POST` | `/api/v1/cluster/scheduler` | Bearer | Set scheduler config |
| `GET` | `/api/v1/cluster/config/proxy` | Bearer | Get proxy config |
| `POST` | `/api/v1/cluster/config/proxy` | Bearer | Set proxy config |

## The CA pinning flow

`GET /api/v1/ca` is public so a fresh client can fetch the daemon's self-signed CA and verify it out of band before sending any credentials. The response contains the CA in PEM form and its SHA-256 fingerprint:

```bash
curl -sk https://cluster.example.com:6443/api/v1/ca
```

```json
{
  "pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "sha256": "ab:cd:ef:01:23:45:..."
}
```

You then pass that fingerprint to `helyos login` so the CLI pins it for all future connections:

```bash
helyos login https://cluster.example.com:6443 \
    --token "$HELYOS_API_TOKEN" \
    --ca-fingerprint ab:cd:ef:01:23:45:...
```

:::tip
If the daemon is running with TLS off or with a bring-your-own certificate, `/api/v1/ca` returns `404 Not Found` with `{ "error": "no self-signed CA (TLS off or BYO cert)" }`. There is no self-signed CA to pin in those cases.
:::

For the end-to-end remote setup, see [Remote access](/docs/guides/remote-access).

## The whoami flow

`GET /api/v1/whoami` returns the identity of the token presented in the `Authorization` header. It is the simplest way to confirm a token is valid and see its scope and metadata:

```bash
curl -sk https://localhost:6443/api/v1/whoami \
    -H "Authorization: Bearer $HELYOS_API_TOKEN"
```

```json
{
  "name": "ci-bot",
  "scope": "admin",
  "created_at": "2026-06-07T10:00:00Z",
  "expires_at": null,
  "last_used_at": "2026-06-07T12:30:00Z"
}
```

The CLI exposes this as `helyos whoami`.

## The token-mint flow

You can mint additional named tokens at runtime with `POST /api/v1/tokens`. The request body accepts a required `name` and optional `scope` and `ttl_secs` (a time-to-live in seconds; a non-positive or omitted value means the token never expires).

```bash
curl -sk https://localhost:6443/api/v1/tokens \
    -H "Authorization: Bearer $HELYOS_API_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{ "name": "ci-bot", "ttl_secs": 2592000 }'
```

The response includes the plaintext secret — this is the **only** time it is ever returned:

```json
{
  "id": "...",
  "name": "ci-bot",
  "token": "nxa-api_0123456789abcdef...",
  "scope": "admin",
  "created_at": "2026-06-07T12:00:00Z",
  "expires_at": "2026-07-07T12:00:00Z"
}
```

:::warning
The secret is shown once and never again — the daemon only stores its Argon2id hash. Capture it immediately. If you lose it, revoke the token and mint a new one.
:::

In v1 every token has `admin` scope; the `scope` field is stored but not yet enforced.

List tokens (the secret and hash are never returned) and revoke a token by name:

```bash
# List
curl -sk https://localhost:6443/api/v1/tokens \
    -H "Authorization: Bearer $HELYOS_API_TOKEN"

# Revoke — returns 204 No Content on success, 404 if no active token has that name
curl -sk -X DELETE https://localhost:6443/api/v1/tokens/ci-bot \
    -H "Authorization: Bearer $HELYOS_API_TOKEN"
```

The CLI wraps these as `helyos auth token create`, `helyos auth token ls`, and `helyos auth token revoke`.

:::note
These named API tokens (prefix `nxa-api_`) are distinct from the **cluster join token** (prefix `nxa_`) used by workers to join a master. The join token is managed via the `/api/v1/cluster/token` endpoints. See [Clustering](/docs/guides/clustering).
:::

## Deploying via the API

The `POST /api/v1/deploy` endpoint takes a deployment spec as JSON. The CLI sends YAML-sourced specs through this route; you can do the same directly:

```bash
curl -sk https://localhost:6443/api/v1/deploy \
    -H "Authorization: Bearer $HELYOS_API_TOKEN" \
    -H 'Content-Type: application/json' \
    -d @spec.json
```

The spec fields are documented in the [Deployment spec reference](/docs/reference/deployment-spec).

## Next steps

- [API tokens](/docs/security/api-tokens) — how tokens are generated, scoped, and revoked
- [TLS & CA pinning](/docs/security/tls-ca-pinning) — verifying the daemon's certificate
- [Remote access](/docs/guides/remote-access) — `helyos login` and connection contexts end to end
- [CLI reference](/docs/reference/cli) — the command-line equivalents of these endpoints
- [Daemon flags](/docs/reference/daemon-flags) — `helyosd` options including `--port`, `--tls`, and `--api-token`
