---
sidebar_position: 4
title: "Scheduling"
description: How Helyos decides which node runs each pod, the spread and binpack strategies, tunable weights, and rescheduling when a node fails.
---

# Scheduling

Scheduling is how Helyos decides **which node** runs each pod. When you deploy a service across a cluster, the daemon scores every eligible node and places the pod on the best one. Helyos uses a single, tunable scheduler — the `WeightedScheduler` — that you can bias toward spreading load evenly or toward packing pods tightly onto fewer nodes.

If you have used Kubernetes, the model is familiar but far simpler: there is one scheduler, two ready-to-use strategies, and four weights you can adjust. No node selectors, affinity rules, or taints to reason about.

:::note

Scheduling only matters in a **multi-node cluster** (master plus workers). On a single node, every pod runs locally and there is nothing to schedule — see [Single-node mode](#single-node-mode) below.

:::

## How placement works

For each pod, the scheduler builds a request from the deployment's `resources` field (CPU cores and memory) and scores every candidate node. Only **ready worker nodes** are considered. Each node gets a score; the highest score wins.

A node is immediately disqualified (scored as "never place here") if any of these is true:

- It is already running its maximum number of pods.
- It has less available CPU than the pod requests.
- It has less available memory than the pod requests.

Among the remaining nodes, the score is a weighted combination of four signals:

| Signal | What it measures |
|---|---|
| `cpu` | Fraction of the node's CPU that would remain free after placing the pod |
| `memory` | Fraction of the node's memory that would remain free after placing the pod |
| `load` | How many pods the node already runs, relative to its capacity |
| `failure` | A penalty for recent pod failures on the node (decays over ~10 minutes) |

The sign and magnitude of each weight determine whether free capacity is rewarded (spread) or penalized (binpack). The `failure` signal is always a penalty, so a node that recently failed pods is avoided under either strategy.

:::info

Pods declare resources via the deployment spec's `resources` block (`cpu` and `memory`). A pod with no `resources` is treated as **best-effort**: it has no CPU or memory floor and can land on any node with free pod slots. See the [deployment spec reference](/docs/reference/deployment-spec).

:::

## Strategies: spread vs binpack

Helyos ships with two named strategies. Each is just a preset of the four weights.

### Spread (default)

`spread` rewards free capacity, so the scheduler prefers the **least-loaded** node. Pods fan out across the cluster, which improves fault isolation and keeps headroom on every node.

This is the default. The spread weights are:

| Weight | Value |
|---|---|
| `cpu` | `0.35` |
| `memory` | `0.35` |
| `load` | `0.15` |
| `failure` | `0.15` |

### Binpack

`binpack` does the opposite: it prefers nodes that are **already busy**, packing pods tightly so you can keep fewer nodes hot and scale the rest down. This favours cost efficiency over isolation.

The binpack weights are:

| Weight | Value |
|---|---|
| `cpu` | `-0.30` |
| `memory` | `-0.30` |
| `load` | `-0.10` |
| `failure` | `0.15` |

Note that the resource weights are negative — remaining free capacity *lowers* the score — while the failure penalty stays positive so a flaky node is still avoided.

:::tip

Use **spread** for high availability and predictable performance. Use **binpack** when you want to consolidate workloads onto as few machines as possible (for example, to scale idle nodes down and save cost).

:::

## Configuring the scheduler

Inspect and change scheduler behaviour with `helyos cluster config`. Changes take effect at runtime — they apply to **future** placements (newly created or rescheduled pods); existing pods are not moved.

### View the current configuration

```bash
helyos cluster config get-scheduler
```

```text
Scheduler configuration:
  Strategy: spread
  Weights:
    cpu:     0.35
    memory:  0.35
    load:    0.15
    failure: 0.15
```

### Switch the strategy

Set the `scheduler` key to `spread` or `binpack`:

```bash
# Pack pods onto fewer nodes
helyos cluster config set scheduler binpack

# Back to spreading load evenly
helyos cluster config set scheduler spread
```

Switching the strategy resets all four weights to that strategy's preset values.

### Tune individual weights

For finer control, set a single weight with the `scheduler.weights.<name>` key, where `<name>` is one of `cpu`, `memory`, `load`, or `failure`:

```bash
# Weight memory more heavily than CPU when spreading
helyos cluster config set scheduler.weights.memory 0.5

# Make the scheduler avoid recently-failed nodes more aggressively
helyos cluster config set scheduler.weights.failure 0.4
```

Adjusting any individual weight moves the strategy into a **custom** mode — the reported strategy becomes `custom`, since the weights no longer match a named preset.

:::warning

Setting an invalid key or weight name is rejected. Valid strategy values are `spread` and `binpack`; valid weight names are `cpu`, `memory`, `load`, and `failure`. Any other value returns an error.

:::

These commands map to the daemon's `GET /api/v1/cluster/scheduler` and `POST /api/v1/cluster/scheduler` endpoints — see the [REST API reference](/docs/reference/rest-api) if you are scripting against the daemon directly.

## Rescheduling on node failure

In a cluster, every worker sends a heartbeat to the master every **5 seconds**. The master runs a monitor that checks all nodes every **10 seconds** and acts on stale heartbeats:

- **No heartbeat for 30 seconds** → the node is marked `NotReady`. New pods stop being scheduled to it, but its existing pods are left alone in case it recovers.
- **No heartbeat for 60 seconds** → the node is considered **dead**. Its pods are marked `Failed`, and the scheduler places replacement pods for the affected deployments onto the remaining healthy nodes.

The replacement pods go through the same scoring process as a fresh deployment, so they respect the current strategy and weights. Because dead nodes are excluded from scoring, your workloads converge back to the desired replica count on the surviving nodes automatically.

:::note

Master nodes are not monitored for heartbeat liveness and are never rescheduled away. The monitor only acts on **worker** nodes.

:::

You can also remove a node from scheduling on purpose:

```bash
# Stop scheduling new pods onto a node (e.g. before maintenance)
helyos node drain web-3

# Remove a node from the cluster entirely
helyos node rm web-3
```

For more on running a cluster, see the [clustering guide](/docs/guides/clustering).

## Single-node mode

When the daemon runs in single-node mode (the default for `helyosd`), there is no cluster transport and no remote nodes. Every pod runs locally through the container runtime — the daemon skips the scoring path entirely and starts the container directly on the host.

This means:

- The scheduler strategy and weights have **no effect**; there is only one place for a pod to run.
- There is no heartbeat monitoring or node-failure rescheduling. Pods that crash are handled by the [restart policy](/docs/concepts/health-and-restart), not by the scheduler.

Scheduling becomes relevant the moment you add a second node and form a cluster.

## See also

- [Scaling](/docs/concepts/scaling) — how replica counts turn into pods the scheduler places
- [Deployments & Pods](/docs/concepts/deployments-and-pods) — the pod lifecycle and desired-state model
- [Health & Restart](/docs/concepts/health-and-restart) — what happens when a pod (not a node) fails
- [Clustering](/docs/guides/clustering) — joining workers and running a multi-node cluster
- [CLI reference](/docs/reference/cli) — full `helyos cluster config` and `helyos node` syntax
