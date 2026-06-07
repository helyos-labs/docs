---
sidebar_position: 4
title: "Automatic TLS"
description: Understand the two TLS layers in Helyos — the control-plane API cert and automatic ACME (Let's Encrypt) TLS for your public routes.
---

# Automatic TLS

Helyos has **two independent TLS layers**, and it helps to keep them separate in your head:

1. **Control-plane API TLS** — encryption for the `helyosd` REST API on port `6443` that the `helyos` CLI talks to. This protects *you talking to the cluster*.
2. **Route TLS (automatic, via ACME)** — Let's Encrypt certificates for the *public domains* your deployments serve. This protects *the internet talking to your apps*.

They use different certificates, are configured with different flags, and solve different problems. This page covers both, in order.

:::info
If you only run Helyos locally, you can ignore both layers — a loopback bind stays plain HTTP for convenience, and you do not need public route certificates. The rest of this page matters once you expose the daemon or serve public traffic.
:::

---

## Layer 1: Control-plane API TLS

The first layer secures the channel between the `helyos` CLI (or any API client) and `helyosd`.

When `helyosd` binds a non-loopback address, the REST API is **HTTPS by default**. On first start the daemon generates a self-signed certificate, with SANs derived from the bind host, `--advertise-addr`, any `--tls-san` values, and the system hostname. TLS behaviour is controlled by `--tls`:

```bash
# Force HTTPS even on a loopback bind
helyosd --tls on

# Use auto (the default): HTTPS unless bound to loopback
helyosd --tls auto

# Bring your own API certificate
helyosd --tls-cert /etc/helyos/api.crt --tls-key /etc/helyos/api.key
```

Clients pin the daemon's CA at login time instead of trusting a public root:

```bash
helyos login https://cluster.example.com:6443 \
  --token "$HELYOS_API_TOKEN" \
  --ca-fingerprint <sha256-from /api/v1/ca>
```

This is a separate certificate from anything ACME issues. It is **not** a Let's Encrypt cert, and it does not cover your application domains.

:::note
The full details of the API certificate, the secure-by-default bind guardrail, and CA pinning live on the security pages. This page does not repeat them. See the [security model](/docs/security/security-model) and [TLS & CA pinning](/docs/security/tls-ca-pinning).
:::

---

## Layer 2: Automatic TLS for public routes (ACME)

The second layer issues real, publicly trusted certificates for the domains your deployments serve, using the [ACME](https://datatracker.ietf.org/doc/html/rfc8555) protocol with [Let's Encrypt](https://letsencrypt.org/).

This layer is wired through the built-in reverse proxy (Traefik by default). When a route is marked for automatic TLS, the proxy is configured to obtain and serve a Let's Encrypt certificate for that domain. See [Routing](/docs/guides/routing) for how routes themselves work.

### Enable ACME on the daemon

Automatic route TLS is off until you give the daemon an ACME contact email. Set it on `helyosd` with `--acme-email`:

```bash
helyosd --acme-email ops@example.com
```

That single flag does two things:

- Configures the reverse proxy to request Let's Encrypt certificates for routes that opt in to TLS.
- Starts the background renewal task (see [Daily renewal](#daily-renewal) below).

:::warning
ACME certificate issuance requires that **Let's Encrypt can reach your domain over the public internet** to complete the HTTP challenge. The domain's DNS must resolve to the host running Helyos, and inbound traffic must reach the proxy. Issuance will fail for domains that are not publicly reachable.
:::

### Mark a route or deployment for HTTPS

There are two ways to request automatic TLS for a domain. Both end up creating a route with TLS mode `auto`.

**In a deployment spec**, set `https: true` under `network` (and give it a `domain`):

```yaml
project: shop
deployment:
  name: api
replicas: 3
image: ghcr.io/company/api:latest
ports:
  - 3000
network:
  public: true
  domain: api.example.com
  https: true
```

```bash
helyos deploy app.yaml
```

**Or with the CLI**, add a route with `--https`:

```bash
helyos route add api.example.com \
  -p shop \
  --deployment api \
  --https
```

Without `--https` (or with `https: false`), the route is created with TLS mode `none` and served over plain HTTP. With it, the route's TLS mode is `auto` and the proxy provisions a Let's Encrypt certificate.

You can confirm the TLS mode per route:

```bash
helyos routes -p shop
```

```text
  Routes                                          1 total
  ┌──────────────────┬─────────┬────────────┬──────┬─────────┐
  │ Domain           │ Project │ Deployment │ TLS  │ Created │
  ├──────────────────┼─────────┼────────────┼──────┼─────────┤
  │ api.example.com  │ shop    │ api        │ auto │ ...     │
  └──────────────────┴─────────┴────────────┴──────┴─────────┘
```

### Daily renewal

Once `--acme-email` is set, `helyosd` runs an automatic renewal task. It wakes up **once a day** and renews any certificate that expires within the next **30 days**. You do not need a cron job or any external tooling — renewal is part of the daemon.

:::tip
Renewal applies to ACME-issued certificates. Imported (bring-your-own) certificates are stored with their own expiry and are surfaced to the same renewal sweep, but Helyos cannot renew a cert it did not issue — re-import an updated cert before it expires.
:::

---

## Bring your own certificate

If you already have a certificate for a domain — for example a wildcard cert, an internal CA, or one issued by a provider other than Let's Encrypt — you can import it instead of using ACME. Use `helyos cert import`:

```bash
helyos cert import api.example.com \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

The `--cert` file should be the certificate (with chain), and `--key` the matching PEM private key. On import:

- The certificate is stored for the given domain and served by the proxy for that route.
- The **private key is encrypted at rest** with AES-256-GCM using the node's master key — the plaintext key is never persisted. This is the same encryption used for [secrets](/docs/security/secrets-encryption).

Bring-your-own certificates do not require `--acme-email`. Helyos will serve the imported cert, but it will not attempt to renew it for you, so plan to re-run `helyos cert import` with a fresh certificate before the old one expires.

---

## Choosing between the two layers

| Question | Layer 1 (API TLS) | Layer 2 (Route TLS) |
|---|---|---|
| What it protects | CLI/API ↔ `helyosd` | Internet ↔ your apps |
| Certificate | Self-signed (or BYO via `--tls-cert`) | Let's Encrypt (or BYO via `helyos cert import`) |
| Trust model | CA pinned at `helyos login` | Publicly trusted root |
| Configured with | `--tls`, `--tls-cert`, `--tls-key`, `--tls-san` | `--acme-email`, route `https: true` / `--https` |
| Renewal | Manual (regenerate / re-supply) | Automatic, daily |

Both layers can be active at the same time and do not interfere with each other. A typical production daemon uses HTTPS for the API (Layer 1, automatic on a non-loopback bind) and ACME for one or more public domains (Layer 2, enabled with `--acme-email`).

---

## Next steps

- [Routing](/docs/guides/routing) — define routes, host-based routing, and proxy backends.
- [Daemon flags](/docs/reference/daemon-flags) — every `helyosd` flag, including `--tls*` and `--acme-email`.
- [Deployment spec](/docs/reference/deployment-spec) — the `network` block (`public`, `domain`, `https`).
- [CLI reference](/docs/reference/cli) — `helyos route` and `helyos cert` command details.

## See also

- [Security model](/docs/security/security-model) — the secure-by-default API and bind guardrail.
- [TLS & CA pinning](/docs/security/tls-ca-pinning) — how the API certificate and CA pinning work.
- [Secrets encryption](/docs/security/secrets-encryption) — the AES-256-GCM scheme that also protects imported private keys.
