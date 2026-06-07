---
sidebar_position: 3
title: "TLS & CA Pinning"
description: How Helyos secures the control-plane API with a self-signed certificate and how the CLI pins its CA on login (trust-on-first-use, fail-closed fingerprint, or out-of-band PEM).
---

# TLS & CA Pinning

This page explains how the Helyos control plane — the `helyosd` REST API on port `6443` — is encrypted, and how the `helyos` CLI establishes trust in that connection. By default the daemon serves HTTPS with a self-signed certificate, and the CLI pins the certificate's CA the first time you log in so that every later request is verified end-to-end.

:::info
This page is about the **control-plane** connection (you talking to the cluster). It is a different TLS layer from the certificates Helyos provisions for your **public routes** (the internet talking to your apps). For automatic ACME / Let's Encrypt route certificates, see [Automatic TLS](/docs/guides/tls).
:::

## The control-plane TLS model

The Helyos REST API listens on `:6443`. Whether it speaks HTTPS or plain HTTP is decided by `--tls`:

| `--tls` value | Behavior |
| --- | --- |
| `auto` (default) | HTTPS, **unless** the bind host is loopback (`127.0.0.1`, `localhost`, `::1`), in which case it stays plain HTTP for local convenience. |
| `on` | Always HTTPS. |
| `off` | Plain HTTP (refused for non-loopback binds unless you also pass `--insecure-http` and have an API token configured). |

On the first start that needs TLS, the daemon generates a **self-signed CA and a server certificate signed by that CA**, then persists them in the data directory (`~/.helyos/data` by default). Restarts reuse the same material, so the CA fingerprint is stable across restarts.

:::tip
A loopback bind staying plain HTTP is intentional: running purely locally requires no certificates and no pinning. The daemon even writes a ready-to-use local CLI context to `~/.helyos/config.toml` on first start, so the local `helyos` CLI just works. TLS and CA pinning matter once you expose the daemon to other machines.
:::

### Secure-by-default guardrails

When you bind to a non-loopback address, Helyos refuses to silently serve cleartext. To serve a non-loopback address over plain HTTP you must pass **both** `--tls off` **and** `--insecure-http`, **and** have an API token configured. Otherwise the daemon exits with an error:

```text
refusing to serve a non-loopback address (0.0.0.0) over plain HTTP;
use --tls on, or pass BOTH --tls off and --insecure-http
```

## The CA endpoint

The daemon exposes its self-signed CA over an unauthenticated endpoint so clients can fetch and verify it before they have any trust established:

```bash
curl -k https://cluster.example:6443/api/v1/ca
```

`GET /api/v1/ca` is public (no Bearer token required) and returns the CA certificate in PEM form plus its SHA-256 fingerprint:

```json
{
  "pem": "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n",
  "sha256": "9f:86:d0:81:88:4c:7d:65:9a:2f:ea:a0:c5:5a:d0:15:a3:bf:4f:1b:2b:0b:82:2c:d1:5d:6c:15:b0:f0:0a:08"
}
```

The fingerprint is the lowercase, colon-separated SHA-256 of the **PEM bytes**. This is the exact value you pin.

:::note
If the daemon is serving plain HTTP, has TLS off, or is using a bring-your-own certificate (no self-signed CA), `GET /api/v1/ca` returns `404` with `{"error":"no self-signed CA (TLS off or BYO cert)"}`. In that case there is nothing to pin — use the system trust store or `--ca-file` instead (see below).
:::

## Pinning the CA with `helyos login`

`helyos login` is how you point the CLI at a remote cluster, authenticate, and pin the CA. It writes a named **context** to `~/.helyos/config.toml` that stores the server URL, the token, and the pinned CA (base64 PEM plus its SHA-256). After login, every CLI command verifies the server against **only** that pinned CA — not the system root store — so the connection is locked to the certificate you trusted.

```bash
helyos login https://cluster.example:6443
```

:::tip
The server argument is forgiving: a bare host like `cluster.example` is expanded to `https://cluster.example:6443`. To target a plain-HTTP daemon, pass an explicit `http://` URL.
:::

There are three ways to establish trust, in increasing order of strictness.

### 1. Trust-on-first-use (default, interactive)

With no CA flags, the CLI fetches `GET /api/v1/ca`, shows you the fingerprint, and asks you to confirm before pinning it:

```bash
helyos login https://cluster.example:6443
```

```text
The server https://cluster.example:6443 presented a self-signed CA:
  SHA-256: 9f:86:d0:81:...:08
Trust and pin this CA? [y/N]
```

This is convenient, but the fetch itself is unverified — you are trusting whatever the network returned at that moment. Verify the fingerprint against a trusted out-of-band source (for example, the value an admin read to you, or `curl -k .../api/v1/ca` run on the server host) before answering yes.

:::warning
Trust-on-first-use requires an interactive terminal. In a non-interactive context (a script or CI job) the CLI refuses to pin without an explicit fingerprint, so you must use `--ca-fingerprint` or `--ca-file` there.
:::

### 2. Fail-closed with `--ca-fingerprint`

Pass the expected SHA-256 and the CLI fetches the CA, compares fingerprints, and **aborts on any mismatch** — no prompt, no chance to accept the wrong cert. This is the right choice for automation and for anyone who has the real fingerprint in hand:

```bash
helyos login https://cluster.example:6443 \
  --ca-fingerprint 9f:86:d0:81:...:08 \
  --token-stdin < token.txt
```

On a mismatch the login fails:

```text
CA fingerprint mismatch — aborting (possible MITM)
  expected: 9f:86:d0:81:...:08
  got:      11:22:33:44:...:ff
```

The comparison is case-insensitive and ignores colons and an optional `sha256:` prefix, so `9F:86:D0...`, `9f86d0...`, and `sha256:9f86d0...` are all accepted.

### 3. Out-of-band with `--ca-file`

If you already have the CA PEM (copied from the server's data directory, or distributed by your team), pin it directly without any network fetch:

```bash
helyos login https://cluster.example:6443 --ca-file ./helyos-ca.pem
```

The CLI reads the file, pins it, and validates your token against it. This is the most robust option because trust never depends on the network at login time.

### Where the pin is stored

The pinned material lives in the context's section of `~/.helyos/config.toml`:

```toml
[context.cluster-example]
server = "https://cluster.example:6443"
token = "nxa-api_..."
ca = "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t..."   # base64 of the CA PEM
ca-sha256 = "9f:86:d0:81:...:08"                  # pinned fingerprint
```

`helyos logout` clears the token but **keeps the server URL and pinned CA**, so logging back in is a single token paste. For more on contexts and the config file, see [CLI Config](/docs/reference/cli-config) and [Remote Access](/docs/guides/remote-access).

## Skipping verification (discouraged)

`--insecure-skip-tls-verify` disables certificate verification entirely for that context. The connection is still encrypted, but it is not authenticated, so it offers no protection against a man-in-the-middle.

```bash
helyos login https://cluster.example:6443 --insecure-skip-tls-verify
```

The CLI prints a warning, and the context records `insecure = true`.

:::danger
Avoid `--insecure-skip-tls-verify` outside throwaway local testing. It defeats the entire point of TLS authentication. Prefer `--ca-fingerprint` (fail-closed) or `--ca-file` (out-of-band) — both give you a verified connection with no extra infrastructure.
:::

## Bring your own certificate

Instead of the auto-generated self-signed cert, you can have the daemon serve a certificate you supply — for example one issued by your internal CA or a publicly-trusted authority:

```bash
helyosd --host 0.0.0.0 --tls on \
  --tls-cert /etc/helyos/api.crt \
  --tls-key  /etc/helyos/api.key
```

When you bring your own cert there is no self-signed CA to serve, so `GET /api/v1/ca` returns `404`. Clients then trust it the normal way:

- For a **publicly-trusted** cert, just `helyos login` with no CA flags — the system root store validates it (omit pinning entirely).
- For a cert from a **private/internal CA**, pin that CA's PEM with `--ca-file <ca.pem>`.

## Subject Alternative Names (SANs)

A pinned certificate only verifies successfully if the hostname or IP you connect to appears in the certificate's SANs. The auto-generated self-signed cert always includes `localhost` and `127.0.0.1`, plus:

- the bind `--host` (unless it is the wildcard `0.0.0.0` or `::`),
- `--advertise-addr`, if set,
- every `--tls-san` you pass (repeatable; each is parsed as an IP if possible, otherwise treated as a DNS name),
- the machine's hostname.

So if clients will reach the daemon by a public DNS name or address, bake it into the cert at start time:

```bash
helyosd --host 0.0.0.0 \
  --advertise-addr cluster.example \
  --tls-san cluster.example \
  --tls-san 203.0.113.10
```

:::note
SANs are baked in only when the self-signed cert is **first generated**. If you change `--tls-san` or `--advertise-addr` later, delete `http-server.pem`, `http-server-key.pem`, and `http-ca.pem` from the data directory so the daemon regenerates the certificate — then re-pin on your clients, since the CA fingerprint changes.
:::

## Note: this is separate from cluster (gRPC) TLS

Helyos also uses TLS for master/worker cluster traffic over gRPC on `:6444`. That is a **separate trust domain** with its own self-signed CA, and it is server-authenticated: workers verify the master's cert, and authenticate themselves with a join token rather than a client certificate. The control-plane CA described on this page (`http-ca.pem`, served by `/api/v1/ca`) and the gRPC CA (`grpc-ca.pem`) rotate independently. See [Clustering](/docs/guides/clustering) for how workers join.

## See also

- [Automatic TLS](/docs/guides/tls) — ACME / Let's Encrypt certificates for your public routes (the other TLS layer).
- [Remote Access](/docs/guides/remote-access) — the full `helyos login` and context workflow for remote clusters.
- [API Tokens](/docs/security/api-tokens) — minting and authenticating with Bearer tokens.
- [Security Model](/docs/security/security-model) — how the control plane is secured overall.
- [Daemon Flags](/docs/reference/daemon-flags) — every `helyosd` TLS and bind flag.
- [CLI Config](/docs/reference/cli-config) — the `~/.helyos/config.toml` context format.
