---
sidebar_position: 1
title: "Deploy a Service"
description: Write a realistic deployment spec, deploy it, verify it is running, then update and redeploy.
---

# Deploy a Service

This guide walks you through the full lifecycle of a service on Helyos: scaffolding and writing a realistic `app.yaml`, deploying it, verifying that it is running, and then updating the spec and redeploying. By the end you will have a multi-replica service with ports, environment variables, a health check, a restart policy, resource limits, and a persistent volume.

If you have not installed Helyos yet, start with the [Installation](/docs/getting-started/installation) guide. For a five-minute tour, see the [Quickstart](/docs/getting-started/quickstart).

## Prerequisites

- A running `helyosd` daemon. When you install Helyos, the daemon starts automatically and writes a local CLI context to `~/.helyos/config.toml`, so the `helyos` CLI works against it with no extra setup.
- The `helyos` CLI on your `PATH`.

Confirm the CLI can reach the daemon:

```bash
helyos status
```

:::tip
To deploy against a remote cluster instead of your local daemon, log in first with `helyos login <server>` and the CLI will pin the daemon's CA and store a named context. See [Remote access](/docs/guides/remote-access).
:::

## 1. Scaffold a project

`helyos init` generates a starter `app.yaml` for you. It writes the file to `<name>/app.yaml` and pre-fills the project and deployment names.

```bash
helyos init shop --image ghcr.io/company/api:1.0.0
```

This creates `shop/app.yaml` with a minimal spec and commented-out example sections. Run `helyos init` with no arguments to be prompted interactively for the project name, deployment name, and image.

:::note
Project and deployment names must be DNS-safe: start with `a-z` or `0-9`, then only lowercase letters, digits, and hyphens, up to 63 characters. Names like `MyApp` or `my_api` are rejected.
:::

## 2. Write a realistic `app.yaml`

Open `shop/app.yaml` and replace it with the spec below. This is a realistic deployment: three replicas of an API, a published port, environment variables, a public HTTPS route, an HTTP health check, an `onfailure` restart policy, resource limits, and a named volume for persistent data.

```yaml
project: shop

deployment:
  name: api

replicas: 3
image: ghcr.io/company/api:1.0.0

# Container ports the service listens on.
ports:
  - 3000

# Plain environment variables (for sensitive values use secrets instead).
env:
  NODE_ENV: production
  LOG_LEVEL: info
  PORT: "3000"

# Expose this deployment on a public domain with automatic TLS.
network:
  public: true
  domain: api.example.com
  https: true

# HTTP health probe. Helyos performs GET <path> against each pod.
healthcheck:
  path: /health
  interval: 10s
  timeout: 5s
  retries: 3

# Restart policy: always | onfailure | never.
restart: onfailure

# Resource limits. memory uses a k/m/g suffix; cpu is a number of cores.
resources:
  cpu: 0.5
  memory: 256m

# Persistent storage. A named volume survives pod restarts and redeploys.
volumes:
  - name: api-data
    mount: /app/data
```

### Field notes

A few details worth calling out, all verified against the spec parser:

- **`restart`** accepts exactly three values: `always` (the default), `onfailure` (one word, no separator), and `never`.
- **`resources.memory`** must match a number followed by a single `k`, `m`, or `g` (case-insensitive), for example `256m`, `512m`, or `1g`. A value like `256MB` is rejected.
- **`resources.cpu`** is a floating-point number of cores (for example `0.5` or `2`) and must be greater than zero.
- **Volumes** use the `mount` key for the in-container path. A named volume is `{name, mount}`; a host bind mount is `{path, mount, readonly}`. Use a named volume unless you specifically need to mount a host directory.
- **`healthcheck`** is HTTP only: Helyos issues `GET <path>` against each pod. There is no TCP or exec probe.
- **`env`** holds non-sensitive configuration. For passwords, API keys, and tokens, use [secrets](/docs/guides/secrets) instead so the values are encrypted at rest and never stored in the spec.

For the complete list of fields, types, and defaults, see the [Deployment spec reference](/docs/reference/deployment-spec).

:::tip
Need a persistent host directory instead of a managed volume? Use a bind mount:

```yaml
volumes:
  - path: /srv/shop/uploads
    mount: /app/uploads
    readonly: false
```
:::

## 3. Deploy

Deploy the spec with a single command. `helyos deploy` validates the YAML locally, sends it to the daemon, and then streams progress until all replicas are running.

```bash
helyos deploy shop/app.yaml
```

You will see the image pull, then each pod transition to `running`, and finally a summary panel reporting `N/N pods ready`.

By default the CLI waits up to 60 seconds for every replica to come up. Pass `--timeout` (in seconds) for slow image pulls or large services:

```bash
helyos deploy shop/app.yaml --timeout 300
```

:::note
If the spec is invalid, `helyos deploy` fails before contacting the daemon and prints the offending field, for example `replicas must be at least 1` or `resources.memory must match format like '512m'`.
:::

:::warning
The `network.https: true` route requests an automatic Let's Encrypt certificate, which requires the daemon to be reachable on the public domain and `--acme-email` to be configured. For local testing, drop the `network` block or set `public: false`. See [Routing](/docs/guides/routing) and [TLS](/docs/guides/tls).
:::

## 4. Verify

Check that the deployment and its pods are healthy.

```bash
# Cluster overview.
helyos status

# Deployments and pods in the 'shop' project.
helyos deployments -p shop
helyos pods -p shop
```

A healthy deployment reports status `running` with all replicas up. Pods move through `Pending` to `Running`; a pod that repeatedly crashes ends up in `CrashLoopBackoff`. For more on these states, see [Deployments and pods](/docs/concepts/deployments-and-pods) and [Health and restart](/docs/concepts/health-and-restart).

Stream logs to confirm the application started cleanly:

```bash
# Follow logs for the 'api' deployment.
helyos logs api -p shop

# Or just the last 100 lines.
helyos logs api -p shop --tail 100
```

For a live, auto-refreshing view of the whole cluster, run the dashboard:

```bash
helyos top
```

:::note
When you omit `-p`/`--project`, the CLI targets the `default` project. Because this service lives in `shop`, pass `-p shop` (or set a default project on your context with `helyos context set <name> --project shop`).
:::

## 5. Update and redeploy

Deployments are declarative: edit `app.yaml` and run `helyos deploy` again. Helyos reconciles the running state to match the new spec. Common updates include bumping the image tag, changing environment variables, or adjusting resources.

For example, ship a new version and raise the memory limit by editing `shop/app.yaml`:

```yaml
image: ghcr.io/company/api:1.1.0

resources:
  cpu: 0.5
  memory: 512m
```

Then redeploy:

```bash
helyos deploy shop/app.yaml
helyos deployments -p shop   # confirm the rollout
helyos logs api -p shop      # watch the new version come up
```

### Scaling

To change only the replica count, you can edit `replicas` in the spec and redeploy, or scale directly without touching the file:

```bash
# Scale the 'api' deployment in the 'shop' project to 5 replicas.
helyos scale api 5 -p shop
```

Keep your `app.yaml` in sync afterward so the file remains the source of truth. See [Scaling](/docs/concepts/scaling) for details.

## 6. Stop or remove

Stop a deployment (its pods are terminated but the deployment record remains, so you can resume by redeploying):

```bash
helyos stop api -p shop
```

Remove a deployment entirely:

```bash
helyos rm api -p shop
# Skip the confirmation prompt in scripts:
helyos rm api -p shop -y
```

:::warning
Removing a deployment deletes its pods. A named volume is managed separately from the deployment lifecycle, so application data on `api-data` is not part of the deployment record. Review your storage before tearing down a project. To remove the whole project and all its resources, use `helyos project delete shop`.
:::

## Next steps

- [Deployment spec reference](/docs/reference/deployment-spec) — every field, type, and default.
- [Secrets](/docs/guides/secrets) — inject encrypted credentials as environment variables.
- [Routing](/docs/guides/routing) — host-based routing and public domains.
- [TLS](/docs/guides/tls) — automatic and bring-your-own certificates.
- [Scaling](/docs/concepts/scaling) and [Health and restart](/docs/concepts/health-and-restart) — keep the service running as you grow.
- [CLI reference](/docs/reference/cli) — the full command set.
