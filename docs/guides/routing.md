---
sidebar_position: 3
title: "Routing & Custom Domains"
description: Expose a deployment on a public domain using the deployment spec or the helyos route command, choose a proxy backend, and manage host-based routes.
---

# Routing & Custom Domains

Helyos ships with a built-in reverse proxy so you can expose a deployment on a custom domain without standing up a separate ingress controller. You attach a domain to a deployment, and the daemon generates the proxy configuration that routes incoming requests by `Host` header to that deployment's pods.

There are two ways to create a route: declaratively in the deployment spec, or imperatively with the `helyos route` command. Both produce the same kind of host-based route.

If you have not deployed a service yet, start with [Deploy a Service](/docs/guides/deploy-a-service).

## How routing works

Helyos runs a reverse proxy in front of your deployments. Each route maps a **domain** to a **deployment** inside a **project**. When a request arrives, the proxy matches the request's `Host` header against your routes and forwards it to the matching deployment's pods. This is **host-based routing**: every domain you register is an independent entry, and you can point many domains at different deployments on the same node.

A route carries a TLS mode that controls how HTTPS is handled:

- `none` — plain HTTP only.
- `auto` — automatic HTTPS via ACME (Let's Encrypt), with daily renewal. This is what `--https` selects.
- `manual` — you bring your own certificate (see [TLS & Certificates](/docs/guides/tls)).

## Option 1: Declare the domain in the spec

The simplest way to expose a service is the `network` block in your deployment spec. Set `public: true`, give it a `domain`, and optionally request `https: true`.

```yaml
project: shop
deployment:
  name: api

replicas: 3
image: ghcr.io/company/api:1.0.0

ports:
  - 3000

network:
  public: true
  domain: api.example.com
  https: true

healthcheck:
  path: /health
  interval: 10s
```

Deploy it as usual and the route is created alongside the deployment:

```bash
helyos deploy app.yaml
```

The `network` block has three fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `public` | bool | `false` | Whether the deployment is exposed through the proxy. |
| `domain` | string | (none) | The host the proxy routes to this deployment. |
| `https` | bool | `false` | Request automatic HTTPS (ACME) for the domain. |

:::note
Make sure your deployment declares the `ports` it listens on. The proxy forwards traffic to the deployment's pods on those ports, so a `network` route without a matching container port has nothing to forward to.
:::

## Option 2: Add a route with the CLI

You can also attach a domain to an existing deployment without editing its spec. This is handy for adding or changing domains after a service is already running.

```bash
helyos route add api.example.com --project shop --deployment api
```

The `route add` arguments map directly to a route:

- `<DOMAIN>` (positional) — the host to route, for example `api.example.com`.
- `-p`, `--project <NAME>` — the project that owns the target deployment (required).
- `--deployment <NAME>` — the deployment to route to (required).
- `--https` — enable automatic HTTPS. With this flag the route's TLS mode is `auto`; without it the route is HTTP-only (`none`).

To create the same route with HTTPS:

```bash
helyos route add api.example.com -p shop --deployment api --https
```

:::tip
`--https` is equivalent to setting `https: true` in the spec's `network` block. Both result in a route with TLS mode `auto`. For HTTPS to actually be served, the daemon needs an ACME email configured (`--acme-email`) so it can request certificates from Let's Encrypt. See [TLS & Certificates](/docs/guides/tls).
:::

## List routes

List every route, or filter to a single project:

```bash
# All routes
helyos routes

# Only routes in the "shop" project
helyos routes --project shop
```

The output shows the domain, owning project, target deployment, TLS mode, and when the route was created:

```text
Domain            Project   Deployment   TLS    Created
api.example.com   shop      api          auto   2026-06-07T10:12:04Z
```

For scripting, add the global `--json` flag to get machine-readable output:

```bash
helyos routes --json
```

## Remove a route

Removing a route takes the domain down from the proxy. It does not stop or delete the deployment — only the host-based route is removed.

```bash
helyos route rm api.example.com
```

:::note
`route rm` is keyed on the domain alone, so you do not pass a project. To take a service fully offline, remove the route and then `helyos stop` or `helyos rm` the deployment.
:::

## Choosing a proxy backend

Helyos can drive any of three reverse-proxy backends. The backend is a daemon-level choice set with the `--proxy-backend` flag on `helyosd`:

| Backend | Value | What the daemon generates |
| --- | --- | --- |
| Traefik (default) | `traefik` | Dynamic YAML configuration (`helyos-dynamic.yml`). |
| nginx | `nginx` | A per-domain config file (`helyos-<domain>.conf`), reloaded through the `nginx` binary. |
| Caddy | `caddy` | A `Caddyfile`, reloaded through Caddy's admin API. |

```bash
# Start the daemon with the nginx backend
helyosd --proxy-backend nginx

# Or with Caddy
helyosd --proxy-backend caddy
```

Related daemon flags:

- `--proxy-backend <BACKEND>` — `traefik` (default), `nginx`, or `caddy`. Any unrecognized value falls back to Traefik.
- `--proxy-config-dir <DIR>` — where the generated proxy config is written. Defaults to `<data-dir>/proxy`.
- `--acme-email <EMAIL>` — the contact email used when requesting ACME certificates for HTTPS routes.

For the full daemon flag reference, see [Daemon Flags](/docs/reference/daemon-flags).

:::warning
The proxy backend is selected once, when the daemon starts. To switch backends you restart `helyosd` with a different `--proxy-backend`. Your routes are stored independently of the backend, so they are re-applied to the new backend on restart.
:::

## TLS for routes

When a route uses HTTPS (TLS mode `auto`), Helyos provisions a certificate automatically from Let's Encrypt via ACME and renews it daily. This requires `--acme-email` to be set on the daemon and the domain's DNS to point at the node running the proxy.

If you would rather supply your own certificate, import it for the domain:

```bash
helyos cert import api.example.com --cert fullchain.pem --key privkey.pem
```

Automatic provisioning, renewal, certificate import, and the daemon's own API certificate are all covered in detail in [TLS & Certificates](/docs/guides/tls).

## See also

- [TLS & Certificates](/docs/guides/tls) — automatic HTTPS, ACME, and bringing your own certificate.
- [Deploy a Service](/docs/guides/deploy-a-service) — write and deploy the spec a route points to.
- [Deployment Spec Reference](/docs/reference/deployment-spec) — the full `network` block and every other field.
- [CLI Reference](/docs/reference/cli) — complete `route`, `routes`, and `cert` command details.
- [Daemon Flags](/docs/reference/daemon-flags) — `--proxy-backend`, `--proxy-config-dir`, and `--acme-email`.
