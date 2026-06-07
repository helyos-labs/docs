---
sidebar_position: 2
title: "Deployments & Pods"
description: Understand how Helyos turns a desired-state deployment into running pods, and how the pod lifecycle works.
---

# Deployments & Pods

Deployments and pods are the two building blocks you work with most in Helyos. A **deployment** describes the desired state of a service — its image, replica count, and runtime configuration. A **pod** is a single running instance of that service: one container, managed by the daemon. Helyos continuously reconciles the two, creating, restarting, and replacing pods until the running reality matches what you asked for.

If you have used Kubernetes, the mental model is familiar — just simpler. There are no ReplicaSets, no controllers to reason about, and no YAML for pods. You declare a deployment; Helyos owns the pods.

## Deployments: the desired state

A deployment is what you author and submit with `helyos deploy`. You write a YAML spec, and the daemon stores it and works to satisfy it. The core fields are:

- `project` — the project the deployment belongs to (required)
- `deployment.name` — the deployment name (required)
- `image` — the container image to run (required)
- `replicas` — how many pods to run (defaults to `1`)
- plus optional `ports`, `env`, `volumes`, `secrets`, `network`, `healthcheck`, `restart`, and `resources`

A minimal deployment looks like this:

```yaml
project: ecommerce

deployment:
  name: api

replicas: 3
image: ghcr.io/company/api:latest

ports:
  - 3000

restart: always # always | onfailure | never
```

Submit it:

```bash
helyos deploy ./api/app.yaml
```

`helyos deploy` reads the spec, sends it to the daemon, and then watches until every pod reports `Running` (or it hits the timeout, default 60 seconds — override with `--timeout SECS`). For the full field reference, see [Deployment Spec](/docs/reference/deployment-spec).

:::note
A deployment is *declarative*. You do not start or stop pods directly — you change the deployment (its replica count, image, or spec) and Helyos reconciles the running pods to match. Re-running `helyos deploy` with an updated spec updates the deployment.
:::

### Deployment status

A deployment carries an aggregate status that reflects the health of its pods:

| Status | Meaning |
|---|---|
| `pending` | The deployment has been accepted but its pods are not yet running. |
| `running` | The deployment is healthy and serving with its desired replicas. |
| `degraded` | Some, but not all, replicas are healthy. |
| `stopped` | The deployment has been stopped (no pods running). |
| `failed` | The deployment could not reach a running state. |

List deployments and their status:

```bash
# All deployments across projects
helyos deployments

# Only one project
helyos deployments -p ecommerce
```

```text
Name   Project     Status    Replicas   Image                          Age
api    ecommerce   running   3          ghcr.io/company/api:latest     2m
```

## Pods: the running instances

A pod is a single running container instance of a deployment. When you set `replicas: 3`, Helyos creates three pods, each with a stable **replica index** (0, 1, 2). The container name is derived from the project, deployment, and index:

```text
helyos-<project>-<deployment>-<replica-index>
```

For example, the deployment above produces `helyos-ecommerce-api-0`, `helyos-ecommerce-api-1`, and `helyos-ecommerce-api-2`.

Each pod also tracks the node it runs on, its container ID and IP, the image it was launched from, and a **restart count** — useful when diagnosing crash loops.

List pods:

```bash
# All pods
helyos pods

# Only one project
helyos pods -p ecommerce
```

```text
Name                       Project     Deployment   Status    Image                          Age
helyos-ecommerce-api-0     ecommerce   api          Running   ghcr.io/company/api:latest     2m
helyos-ecommerce-api-1     ecommerce   api          Running   ghcr.io/company/api:latest     2m
helyos-ecommerce-api-2     ecommerce   api          Running   ghcr.io/company/api:latest     2m
```

:::tip
Use `helyos top` for a live, auto-refreshing dashboard of deployments, pods, and nodes — handy while a deployment is rolling out or recovering.
:::

## Deployment-to-pod relationship

The relationship is one deployment to many pods, governed entirely by `replicas`:

```text
Deployment "api" (replicas: 3)
  ├── Pod helyos-ecommerce-api-0
  ├── Pod helyos-ecommerce-api-1
  └── Pod helyos-ecommerce-api-2
```

Helyos keeps the number of pods equal to `replicas`. When you scale, it adds or removes pods to close the gap:

```bash
# Run five instances instead of three
helyos scale api 5 -p ecommerce
```

If a pod exits or fails, Helyos replaces it according to the deployment's restart policy, so the desired replica count is restored. You never manage individual pods by hand — you change the deployment and let reconciliation do the work. See [Scaling](/docs/concepts/scaling) for how replica changes are applied.

## Pod lifecycle

Every pod moves through a well-defined set of states. The happy path is `Pending → Creating → Running`; from there a pod can be stopped, can fail, or can enter a restart cycle.

| Status | Meaning |
|---|---|
| `Pending` | The pod has been created and is waiting to be scheduled onto a node. |
| `Creating` | The container is being created and started on its node. |
| `Running` | The container is up. If a healthcheck is configured, it is passing. |
| `Stopping` | The pod is being shut down (for example, after `helyos stop` or a scale-down). |
| `Stopped` | The pod has been shut down and is no longer running. |
| `Failed` | The container exited unexpectedly and is not being restarted. |
| `Restarting` | The container exited and is being restarted per the restart policy. |
| `CrashLoopBackoff` | The container keeps crashing and has hit the crash-loop threshold; restarts are backed off. |

A simplified view of the transitions:

```text
Pending ──▶ Creating ──▶ Running ──▶ Stopping ──▶ Stopped
                            │
                            ├──▶ Failed
                            │
                            └──▶ Restarting ──▶ Running
                                     │
                                     └──▶ CrashLoopBackoff
```

### Restarts and crash loops

When a container exits, Helyos consults the deployment's `restart` policy:

- `always` (default) — restart on any exit, success or failure
- `onfailure` — restart only on a non-zero exit code (note: one word, `onfailure`)
- `never` — never restart; the pod transitions to `Failed`

Restarts use **capped exponential backoff**: the delay starts at 1 second and doubles with each restart, up to a 5-minute ceiling. After **10 restarts**, the pod is marked `CrashLoopBackoff` to signal that something is fundamentally wrong (a bad image, a missing dependency, a failing healthcheck). The restart counter resets once a pod has stayed healthy continuously for 10 minutes.

:::warning
`CrashLoopBackoff` almost always means the application itself is failing to start or a healthcheck never passes. Inspect the logs (`helyos logs <name>`) before scaling or redeploying — restarting a broken image just loops again.
:::

Restart and health behavior is covered in depth in [Health & Restart](/docs/concepts/health-and-restart).

## Inspecting and managing pods

### View logs

Stream logs for a deployment's pods in real time:

```bash
# Follow live logs
helyos logs api -p ecommerce

# Show the last 100 lines
helyos logs api -p ecommerce --tail 100
```

Logs stream until you press `Ctrl-C`.

### Stop a deployment

Stopping a deployment shuts down its pods but keeps the deployment definition so you can resume it later by redeploying or scaling back up:

```bash
helyos stop api -p ecommerce
```

The deployment moves to `stopped` and its pods to `Stopped`.

### Remove a deployment

Removing a deployment stops its pods *and* deletes the deployment definition:

```bash
# Prompts for confirmation
helyos rm api -p ecommerce

# Skip the confirmation prompt
helyos rm api -p ecommerce -y
```

:::info
When the `-p`/`--project` flag is omitted, commands target the `default` project (or the project set on your active CLI context). Set a default project per context with `helyos context set <name> --project <project>`.
:::

## Next steps

- [Scaling](/docs/concepts/scaling) — change replica counts and how Helyos reconciles pods
- [Health & Restart](/docs/concepts/health-and-restart) — healthchecks, restart policies, and backoff
- [Scheduling](/docs/concepts/scheduling) — how pods are placed onto nodes
- [Deployment Spec](/docs/reference/deployment-spec) — the full YAML field reference
- [CLI Reference](/docs/reference/cli) — every `helyos` command and flag
