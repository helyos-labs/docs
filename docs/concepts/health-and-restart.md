---
sidebar_position: 5
title: "Health Checks & Restart Policies"
description: Configure HTTP health probes and restart policies so Helyos keeps your pods healthy with exponential backoff and crash-loop detection.
---

# Health Checks & Restart Policies

Helyos keeps your workloads healthy in two complementary ways: **health checks** detect when a running container has gone bad, and **restart policies** decide what happens when a container exits. Together they give you self-healing deployments without any external tooling.

This page explains both mechanisms, how they interact, and how to configure them in your deployment spec.

## Health checks

A health check is an HTTP probe that Helyos runs against each pod on a fixed interval. If a pod fails enough consecutive probes, Helyos considers it unhealthy and restarts it in place.

:::info 
HTTP probes only
Helyos supports **HTTP health probes only**. There is **no TCP probe and no exec/command probe**. The daemon sends an HTTP `GET` to a path on your container and treats any `2xx` response as healthy; anything else (non-success status, connection error, or timeout) counts as a failure.
:::

### Fields

You configure a health check under the `healthcheck` key in your deployment spec. All fields except `path` have defaults.

| Field      | Type     | Default | Description                                                              |
| ---------- | -------- | ------- | ------------------------------------------------------------------------ |
| `path`     | string   | —       | HTTP path to probe, for example `/health`. Required.                     |
| `interval` | duration | `10s`   | How often to probe (for example `5s`, `30s`).                            |
| `timeout`  | duration | `5s`    | How long to wait for a response before counting the probe as a failure. |
| `retries`  | integer  | `3`     | Consecutive failures required before the pod is restarted.               |

### Example

```yaml
project: ecommerce

deployment:
  name: api

image: ghcr.io/company/api:latest
replicas: 3

ports:
  - 3000

healthcheck:
  path: /health
  interval: 10s
  timeout: 5s
  retries: 3
```

With this configuration, Helyos probes `http://<pod-ip>:3000/health` every 10 seconds. If the endpoint fails to return a success status three times in a row, the pod is restarted.

:::note 
A port is required for probing
The probe targets the **first port** in your deployment's `ports` list. If a deployment declares a `healthcheck` but no `ports`, Helyos has no port to probe and the health check is silently skipped. Always declare the port your health endpoint listens on.
:::

### How the probe state machine works

Each pod tracks one of three health states. A single successful probe immediately clears any accumulated failures:

- **Healthy** — the pod is responding. The default state when a pod starts.
- **Failing** — at least one probe has failed, but fewer than `retries` in a row. A single success returns the pod to **Healthy**.
- **Unhealthy** — `retries` consecutive failures have occurred. This triggers a restart, and the pod is no longer probed until it is recreated.

For example, with `retries: 3`:

1. Probe fails → `Failing` (1 consecutive failure)
2. Probe fails → `Failing` (2 consecutive failures)
3. Probe fails → `Unhealthy` → **restart triggered**

If a probe had succeeded at step 2, the counter would reset and the pod would return to `Healthy`.

:::tip 
Make your health endpoint cheap and honest
Your `/health` endpoint should return success only when the pod can actually serve traffic, and it should respond well within `timeout`. A slow health endpoint causes timeouts that look like failures and can trigger unnecessary restarts. If startup is slow, give the pod room with a generous `interval` and `retries` rather than a long `timeout`.
:::

## Restart policies

A restart policy controls what Helyos does when a container **exits** (the process stops on its own or crashes). This is separate from a failed health check, though both paths can lead to a restart.

Set the policy with the top-level `restart` field. The default is `always`.

| Value       | Behavior                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `always`    | Restart the container whenever it exits, regardless of exit code. Default. |
| `onfailure` | Restart only when the container exits with a non-zero exit code.          |
| `never`     | Never restart. The pod is marked `Failed` when the container exits.      |

:::warning 
The value is `onfailure` — one word
The on-failure policy is spelled **`onfailure`** (lowercase, no hyphen, no underscore). Values like `on-failure`, `on_failure`, or `OnFailure` are **not** accepted. Use exactly `always`, `onfailure`, or `never`.
:::

### Example

```yaml
project: batch

deployment:
  name: importer

image: ghcr.io/company/importer:latest

# Restart only if the job exits with a non-zero code.
# A clean exit (code 0) leaves the pod in the Failed state instead.
restart: onfailure
```

```yaml
project: web

deployment:
  name: frontend

image: nginx:latest
ports:
  - 80

# Long-running service: keep it up no matter how it exits.
restart: always
```

## Exponential backoff

When a pod is eligible for restart, Helyos does not retry immediately in a tight loop. Instead it waits a delay that grows exponentially with each restart:

```text
delay = min(300s, 1s × 2^(restart_count - 1))
```

So the first restart waits about 1 second, then roughly 2s, 4s, 8s, 16s, and so on, capped at a maximum of **5 minutes (300 seconds)** between attempts. This gives a failing dependency (a database that is still starting, for example) time to recover instead of hammering it.

The restart counter resets to zero after a pod has stayed **healthy for 10 minutes (600 seconds)** continuously. A pod that recovers and stays up is treated as fresh, so an occasional blip does not count against it forever.

## Crash-loop detection

If a pod keeps exiting and being restarted, Helyos eventually stops trying. After **10 restarts** without a sustained recovery, the pod is moved to the `CrashLoopBackoff` status and is no longer restarted automatically.

```text
Running → (exit) → Restarting → (backoff) → Running → ... → CrashLoopBackoff
```

This protects your cluster from a pod that can never become healthy: rather than burning resources on endless restarts, Helyos surfaces the problem so you can investigate.

:::tip 
Diagnosing a crash loop
When you see `CrashLoopBackoff`, inspect the pod's logs to find why the container keeps exiting:

```bash
helyos logs api -p ecommerce --tail 100
helyos pods -p ecommerce
```

Fix the underlying issue (bad config, missing secret, failing migration) and redeploy. A fresh deployment starts the pod with a clean restart counter.
:::

## How health checks and restart policies interact

These two mechanisms cover different failure modes, and they work together:

- A **container that exits** is handled by the **restart policy**. With `restart: always`, a process that crashes is brought back; with `onfailure`, only non-zero exits are restarted; with `never`, the pod becomes `Failed`.
- A **container that stays running but stops responding** is caught by the **health check**, which restarts the pod once it crosses the `retries` threshold.

Both restart paths share the same exponential backoff and crash-loop detection. A pod that is repeatedly killed by failing health checks will eventually land in `CrashLoopBackoff` just like one that keeps crashing on its own.

:::note 
Defaults at a glance
If you specify nothing, a deployment has `restart: always` and **no** health check. Pods restart whenever the container exits, but Helyos cannot detect a hung-but-running process until you add a `healthcheck`.
:::

## Full example

Putting it together, here is a service that uses both an HTTP health check and an explicit restart policy:

```yaml
project: ecommerce

deployment:
  name: api

image: ghcr.io/company/api:latest
replicas: 3

ports:
  - 3000

env:
  NODE_ENV: production

healthcheck:
  path: /health
  interval: 10s
  timeout: 5s
  retries: 3

restart: onfailure
```

Deploy it and watch pod status as Helyos keeps it healthy:

```bash
helyos deploy app.yaml
helyos pods -p ecommerce
helyos logs api -p ecommerce
```

## See also

- [Deployments & Pods](/docs/concepts/deployments-and-pods) — the pod lifecycle and statuses, including `CrashLoopBackoff`.
- [Deployment spec reference](/docs/reference/deployment-spec) — every field you can set in a deployment file.
- [Scaling](/docs/concepts/scaling) — how replicas and rescheduling work alongside health checks.
- [Observability](/docs/guides/observability) — logs, events, and metrics for debugging unhealthy pods.
