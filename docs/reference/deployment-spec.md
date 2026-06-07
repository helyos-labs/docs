---
sidebar_position: 2
title: "Deployment Spec"
description: Complete YAML schema reference for a Helyos deployment spec — every field, its type, default, and whether it is required, with a full annotated example.
---

# Deployment Spec

A deployment spec is the declarative YAML file you hand to `helyos deploy`. It describes a single deployment: which image to run, how many replicas, what ports and environment it needs, where to mount storage, how to health-check it, when to restart it, and how to expose it on the network. The daemon parses, validates, and reconciles it into running pods.

This page is the complete schema reference. Every field is listed with its type, default, and whether it is required, grouped by section, followed by a full annotated example.

```bash
helyos deploy app.yaml
```

:::tip
You don't have to write a spec by hand. Run `helyos init NAME --image IMG` to scaffold a starter `NAME/app.yaml`, then edit it. See the [CLI reference](/docs/reference/cli).
:::

## Minimal spec

Only three things are required: `project`, `deployment.name`, and `image`. Everything else has a default or is optional.

```yaml
project: myapp
deployment:
  name: api
image: nginx:latest
```

This deploys one replica of `nginx:latest` into the `myapp` project as a deployment named `api`, with the default restart policy (`always`).

## Top-level fields

These fields live at the root of the document.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `project` | string | Yes | — | Project the deployment belongs to. Must be DNS-safe (see [Naming rules](#naming-rules)). Created automatically if it does not exist. |
| `deployment` | object | Yes | — | Deployment metadata. See [Deployment](#deployment). |
| `image` | string | Yes | — | Container image to run, e.g. `nginx:latest` or `ghcr.io/company/api:1.2.3`. Must be non-empty. |
| `replicas` | uint | No | `1` | Number of pod replicas to run. Must be at least 1. |
| `ports` | list of int | No | `[]` | Container ports to expose. Each must be between 1 and 65535. |
| `env` | map string→string | No | `{}` | Environment variables injected into every container. |
| `volumes` | list | No | `[]` | Storage to mount. See [Volumes](#volumes). |
| `secrets` | list of string | No | `[]` | Names of project secrets to inject as environment variables. See [Secrets](#secrets). |
| `network` | object | No | unset | Public exposure / routing config. See [Network](#network). |
| `healthcheck` | object | No | unset | HTTP health probe. See [Healthcheck](#healthcheck). |
| `restart` | enum | No | `always` | Restart policy. See [Restart](#restart). |
| `resources` | object | No | unset | CPU / memory limits. See [Resources](#resources). |

:::info
Fields with a default may be omitted entirely. Fields marked "unset" are optional objects — omit them and the feature is simply not configured (no health probing, no public route, no resource limits).
:::

## Deployment

The `deployment` object holds metadata about the deployment itself.

```yaml
deployment:
  name: api
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Deployment name, unique within its project. Must be DNS-safe (see [Naming rules](#naming-rules)). Used in DNS names, pod names, and CLI commands. |

## Ports and environment

`ports` is a flat list of integers, and `env` is a string-to-string map.

```yaml
ports:
  - 3000
  - 8080

env:
  NODE_ENV: production
  LOG_LEVEL: info
```

Each port must be in the range 1–65535; a port of `0` is rejected at validation. Environment values are always strings, so quote anything that could be misread as a number, boolean, or null in YAML.

:::tip
Use `env` for non-sensitive configuration only. For passwords, API keys, and tokens, use [secrets](#secrets) so the value is encrypted at rest and kept out of your spec.
:::

## Volumes

`volumes` is a list. Each entry is **one of two shapes**, distinguished by which keys are present:

- A **named volume** — managed by the runtime, persists across pod restarts — uses `name` + `mount`.
- A **bind mount** — maps a path from the host into the container — uses `path` + `mount` (+ optional `readonly`).

:::warning
The container-side path key is `mount` (one word), **not** `mount_path`. This is the single most common mistake when writing a volume entry.
:::

### Named volume

```yaml
volumes:
  - name: data
    mount: /app/data
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Name of the managed volume. Reused across restarts so data persists. |
| `mount` | string | Yes | — | Absolute path **inside the container** where the volume is mounted. |

Named volumes are always read-write.

### Bind mount

```yaml
volumes:
  - path: /host/uploads
    mount: /app/uploads
    readonly: true
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | Yes | — | Absolute path **on the host** to mount into the container. |
| `mount` | string | Yes | — | Absolute path **inside the container** where the host path appears. |
| `readonly` | bool | No | `false` | Mount the host path read-only when `true`. |

You can mix both kinds in a single list:

```yaml
volumes:
  - name: data
    mount: /app/data
  - path: /host/uploads
    mount: /app/uploads
    readonly: true
```

:::info
Because the two shapes are distinguished by their keys, a valid entry must contain either `name` + `mount` (named volume) or `path` + `mount` (bind mount). The `readonly` flag applies only to bind mounts.
:::

## Network

The optional `network` object controls whether the deployment is exposed outside the cluster and on which domain. Omit it for an internal-only service.

```yaml
network:
  public: true
  domain: api.example.com
  https: true
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `public` | bool | No | `false` | Expose the deployment through the built-in reverse proxy. |
| `domain` | string | No | unset | Host the deployment is routed under, e.g. `api.example.com`. |
| `https` | bool | No | `false` | Serve the route over HTTPS. With ACME configured, a certificate is obtained and renewed automatically. |

See the [Routing guide](/docs/guides/routing) and [TLS guide](/docs/guides/tls) for how public routes and certificates work. Internal-only deployments are still reachable cluster-side via [service discovery](/docs/concepts/service-discovery).

## Healthcheck

The optional `healthcheck` object configures an HTTP probe. Helyos supports **HTTP probes only** — it issues `GET <path>` against each pod. There is no TCP or exec probe.

```yaml
healthcheck:
  path: /health
  interval: 10s
  timeout: 5s
  retries: 3
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | Yes | — | HTTP path to probe with `GET`, e.g. `/health`. |
| `interval` | duration | No | `"10s"` | How often to run the probe. |
| `timeout` | duration | No | `"5s"` | How long to wait for a response before the probe counts as failed. |
| `retries` | uint | No | `3` | Consecutive failures tolerated before the pod is considered unhealthy. |

**Duration format.** `interval` and `timeout` are strings with a unit suffix: `ms` (milliseconds), `s` (seconds), `m` (minutes), or `h` (hours). A bare number (e.g. `"30"`) is interpreted as seconds. Examples: `"500ms"`, `"10s"`, `"5m"`, `"2h"`.

See [Health and restart](/docs/concepts/health-and-restart) for how probe results drive the pod state machine.

## Resources

The optional `resources` object sets per-container CPU and memory limits. Omit it to run without explicit limits.

```yaml
resources:
  memory: 512m
  cpu: 0.5
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `memory` | string | Yes (when `resources` is present) | — | Memory limit, e.g. `512m`, `1g`, `256k`. Format: digits followed by a unit `k`, `m`, or `g` (case-insensitive). |
| `cpu` | float | Yes (when `resources` is present) | — | CPU limit in cores. Must be greater than 0; fractions like `0.5` are allowed. |

:::warning
If you include the `resources` block, both `memory` and `cpu` are required. A `memory` value like `512mb` or `512` (no unit) is rejected — the format is a number plus a single `k`/`m`/`g` suffix. A `cpu` of `0` or a negative value is also rejected.
:::

## Restart

The `restart` field sets the policy for restarting a pod when its container exits. It is a single string value, defaulting to `always`.

```yaml
restart: onfailure
```

| Value | Description |
|---|---|
| `always` | **(default)** Always restart the container when it exits, regardless of exit code. |
| `onfailure` | Restart only when the container exits with a non-zero (failure) status; do not restart on a clean exit. |
| `never` | Never restart the container automatically. |

:::warning
The failure policy value is `onfailure` — **one word, all lowercase, no hyphen or underscore**. `on-failure`, `on_failure`, and `OnFailure` are not valid.
:::

Restarts use exponential backoff, and a container that keeps crashing is flagged as a crash loop (`CrashLoopBackoff`) rather than restarted indefinitely. See [Health and restart](/docs/concepts/health-and-restart) for the full lifecycle.

## Secrets

`secrets` is a list of secret **names** (strings). Each named secret must already exist in the deployment's project; at deploy time its value is decrypted and injected into every container as an environment variable using the secret name as the variable name.

```yaml
secrets:
  - DATABASE_URL
  - STRIPE_KEY
```

Create the secrets first with the CLI:

```bash
helyos secret set DATABASE_URL --value "postgres://..." -p myapp
helyos secret set STRIPE_KEY --value "sk_live_..." -p myapp
```

See the [Secrets guide](/docs/guides/secrets) and [Secrets encryption](/docs/security/secrets-encryption) for details.

## Naming rules

`project` and `deployment.name` must be **DNS-safe**:

- Start with a lowercase letter or digit (`a-z`, `0-9`).
- Contain only lowercase letters, digits, and hyphens (`a-z`, `0-9`, `-`) thereafter.
- Be at most 63 characters long.

Valid: `my-app-123`, `api`, `api-v2`. Invalid: `MyApp` (uppercase), `-myapp` (leading hyphen), `my_api` (underscore), or any name over 63 characters.

These names appear in DNS records like `<deployment>.<project>.internal`, so the DNS-safe constraint keeps service discovery working. See [Service discovery](/docs/concepts/service-discovery).

## Full annotated example

A complete spec exercising every section:

```yaml
# Project the deployment belongs to (required, DNS-safe).
project: ecommerce

deployment:
  name: api          # Deployment name (required, DNS-safe).

replicas: 3          # Run three pods. Default is 1.
image: ghcr.io/company/api:latest   # Container image (required).

ports:
  - 3000             # Container ports (1-65535).

env:                 # Non-sensitive environment variables.
  NODE_ENV: production
  LOG_LEVEL: info

secrets:             # Project secrets injected as env vars (must already exist).
  - DATABASE_URL
  - STRIPE_KEY

volumes:
  - name: data       # Named volume (persists across restarts, read-write).
    mount: /app/data           # Container path. Key is "mount", not "mount_path".
  - path: /host/uploads        # Bind mount: a host path...
    mount: /app/uploads        # ...mapped to this container path.
    readonly: true             # Optional; defaults to false.

network:
  public: true               # Expose through the reverse proxy.
  domain: api.example.com    # Route host.
  https: true                # Serve over HTTPS (ACME if configured).

healthcheck:
  path: /health      # HTTP GET probe (HTTP only — no TCP/exec).
  interval: 10s      # Default "10s".
  timeout: 5s        # Default "5s".
  retries: 3         # Default 3.

restart: onfailure   # always | onfailure | never. Default "always".

resources:
  memory: 512m       # Number + k/m/g (case-insensitive).
  cpu: 0.5           # Cores; must be > 0.
```

Validate and apply it:

```bash
helyos deploy app.yaml
```

The daemon validates the spec on every load path, so an invalid file is rejected before any container is created, with an error naming the offending field.

## See also

- [Deploy a service](/docs/guides/deploy-a-service) — a hands-on walkthrough using a spec.
- [CLI reference](/docs/reference/cli) — `helyos init`, `helyos deploy`, and related commands.
- [Health and restart](/docs/concepts/health-and-restart) — how probes and restart policies behave at runtime.
- [Routing](/docs/guides/routing) and [TLS](/docs/guides/tls) — exposing deployments publicly.
- [Secrets](/docs/guides/secrets) — creating the secrets referenced by `secrets:`.
