---
sidebar_position: 3
title: "Scaling"
description: How replicas work in Helyos, how to scale a deployment up and down, and how the orchestrator reconciles desired state with what is actually running.
---

# Scaling

Scaling in Helyos means changing how many copies of a service run. You declare a desired number of **replicas**, and the orchestrator continuously works to make reality match that number — creating pods when you scale up and removing them when you scale down. You never manage individual pods by hand; you change the desired count and let Helyos converge on it.

This page covers what replicas are, how to scale with the CLI and API, how reconciliation works under the hood, and how to stop a deployment entirely.

## Replicas

A **replica** is one running instance of a deployment — a single container, wrapped as a [pod](/docs/concepts/deployments-and-pods). Running multiple replicas gives you horizontal capacity (more pods sharing the load) and resilience (one pod can fail without taking the service down).

You set the desired replica count in the deployment spec with the `replicas` field, which defaults to `1`:

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

Deploy it, and the orchestrator brings up three pods, indexed `0`, `1`, and `2`:

```bash
helyos deploy ecommerce/app.yaml
helyos pods --project ecommerce
```

Each pod has a stable `replica_index`, and its container is named `helyos-<project>-<deployment>-<index>` — for example `helyos-ecommerce-api-0`. The index is also used for per-pod [service discovery](/docs/concepts/service-discovery) names like `api-0.ecommerce.internal`.

:::info Port publishing and replicas
A deployment's `ports` are published to the host **only when `replicas` is `1`**. With more than one replica, Helyos does not bind host ports (multiple containers cannot share the same host port). To expose a multi-replica service, put it behind the built-in reverse proxy with a [route](/docs/guides/routing) rather than a host port.
:::

## Scaling with the CLI

Use `helyos scale` to change the replica count of an existing deployment without editing or re-deploying the YAML:

```bash
# Scale the "api" deployment in the "ecommerce" project to 5 replicas
helyos scale api 5 --project ecommerce
```

The `--project` flag (short form `-p`) selects the project; it defaults to `default` if omitted. The command updates the deployment's desired `replicas` and waits for the orchestrator to reconcile, then reports the new count.

You can verify the result:

```bash
helyos deployments --project ecommerce   # shows desired replica count + status
helyos pods --project ecommerce          # shows the actual pods
```

For scripting and CI, add `--json` to any command to get machine-readable output:

```bash
helyos scale api 5 --project ecommerce --json
```

### Scaling via the REST API

`helyos scale` is a thin wrapper over the daemon's REST endpoint. You can call it directly with a bearer token:

```bash
curl -sk -X POST https://localhost:6443/api/v1/projects/ecommerce/deployments/api/scale \
  -H "Authorization: Bearer $HELYOS_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"replicas": 5}'
```

(The daemon serves the API over `https://` when bound to a non-loopback address; on a default local bind it is `http://localhost:6443`. The `-k` flag accepts the daemon's self-signed certificate for quick testing — see the [REST API reference](/docs/reference/rest-api) for the CA-pinning flow.)

The response is the updated deployment object. See the [REST API reference](/docs/reference/rest-api) for full details.

## How reconciliation works

Helyos is **declarative**: you describe the desired state, and the orchestrator drives the system toward it. When you scale, the daemon does not directly start or stop containers on your behalf — it records your new desired replica count and then runs a reconciliation pass for that deployment.

Reconciliation compares the **desired** replica count against the **actual** number of pods that currently exist for the deployment, and acts on the difference:

- **Desired greater than actual** → it creates the missing pods (the scheduler picks a node for each new pod, then the runtime starts the container).
- **Desired less than actual** → it removes the extra pods. It sorts the existing pods by creation time and removes the **newest** ones first, so your longest-running, most-settled pods are kept.
- **Desired equals actual** → nothing changes.

When scaling down, each removed pod is cleanly torn down: its health checks are unregistered, its service-discovery DNS records are deregistered, and its container is stopped (with a grace period) and removed.

After reconciliation, the orchestrator recomputes the deployment's status from its pods:

- **Running** — all pods are running and the desired count is greater than zero
- **Degraded** — at least one pod has failed
- **Pending** — pods are still coming up
- **Stopped** — the deployment has been stopped (see below)

:::note Reconciliation is continuous
The same reconcile logic runs not only when you scale, but also when a project is resumed, when a deployment is first created, and when a node dies. If a pod is lost — for example, because its node went down — the orchestrator notices the actual count has dropped below the desired count and recreates the pod, rescheduling it onto a healthy node. You get self-healing without doing anything.
:::

## The rolling nature of scaling

Scaling in Helyos is **additive and incremental**, not a stop-the-world replacement:

- Scaling **up** only creates the new pods you asked for. Existing, healthy pods are never touched, so there is no disruption to running traffic.
- Scaling **down** only removes the surplus pods (newest first); the remaining pods keep serving.

Because existing pods are left in place during a scale operation, a multi-replica service stays available while it grows or shrinks. New pods join as they become healthy, and removed pods are drained from DNS before their containers stop.

:::tip Health checks make scaling safer
Define an HTTP [health check](/docs/concepts/health-and-restart) so a new replica that starts but does not actually serve gets caught. A pod is marked `Running` as soon as its container starts, but a failing health check then marks it unhealthy and triggers a restart — so a broken replica is replaced rather than left silently in rotation while you scale.
:::

## Scaling to zero vs. stopping

There are two ways to bring a deployment down to no running pods, and they mean different things:

### Scale to zero

```bash
helyos scale api 0 --project ecommerce
```

This sets the desired replica count to `0`. The orchestrator reconciles by removing all pods, but the deployment **keeps a desired count of zero**. Scale it back up later with another `helyos scale`.

### Stop

```bash
helyos stop api --project ecommerce
```

`helyos stop` removes all of a deployment's pods and marks the deployment **Stopped**. The deployment definition is preserved (it is not deleted), so you can bring it back, but its status reflects that it was deliberately stopped rather than scaled down.

:::note Stop a whole project at once
Stopping is also available at the project level. Suspending a project stops every deployment it contains, and resuming it brings them all back by reconciling each deployment to its desired replica count. See [Projects](/docs/concepts/projects).
:::

To remove a deployment entirely — pods, container resources, and the definition — use `helyos rm`:

```bash
helyos rm api --project ecommerce
```

## Examples

Bring up a service with three replicas, scale it to handle a traffic spike, then scale it back:

```bash
# Deploy at 3 replicas (from the spec)
helyos deploy ecommerce/app.yaml

# Traffic spike — scale up to 10
helyos scale api 10 --project ecommerce

# Watch the pods come online
helyos pods --project ecommerce

# Spike over — scale back down to 3 (newest pods removed first)
helyos scale api 3 --project ecommerce

# Quiet period — wind down to zero without losing the deployment
helyos scale api 0 --project ecommerce

# Bring it back later
helyos scale api 3 --project ecommerce
```

Keep an eye on a deployment as you scale with the live dashboard:

```bash
helyos top
```

## Next steps

- [Deployments & Pods](/docs/concepts/deployments-and-pods) — the building blocks scaling operates on
- [Scheduling](/docs/concepts/scheduling) — how Helyos decides which node each new replica lands on
- [Health & Restart](/docs/concepts/health-and-restart) — what makes a replica count as ready
- [Projects](/docs/concepts/projects) — suspend and resume whole groups of deployments
- [CLI reference](/docs/reference/cli) — full command and flag list, including `scale`, `stop`, and `rm`
