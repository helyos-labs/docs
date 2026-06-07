---
sidebar_position: 5
title: "Multi-Node Clustering"
description: Start a master, join workers with a token, and understand heartbeats, rescheduling, and node lifecycle in Helyos.
---

# Multi-Node Clustering

Helyos scales from a single host to a multi-node cluster with one extra flag. You run one daemon as the **master**, then point as many **worker** daemons at it as you need. Workers register over gRPC, send periodic heartbeats, and receive pod assignments from the master. When a worker goes silent, the master reschedules its pods onto healthy nodes.

This guide walks through starting a master, joining workers, and operating the cluster day-to-day: heartbeats, rescheduling, draining, removing nodes, and rotating the join token.

:::info 
Topology

A Helyos cluster is a single master plus N workers. The master runs the orchestrator, scheduler, REST API, and gRPC cluster server; workers run containers and report back. There is no external datastore — the master persists cluster state in its local SQLite store.
:::

## Start the master

Start `helyosd` in master mode. The master is also where you typically run the embedded DNS server (for `<deployment>.<project>.internal` service discovery) and the overlay network.

```bash
helyosd \
  --mode master \
  --host 0.0.0.0 \
  --advertise-addr 10.0.1.1 \
  --dns-mode embedded \
  --master-ip 10.0.1.1 \
  --overlay
```

What these flags do:

- `--mode master` enables the gRPC cluster server (default port `6444`) alongside the REST API on `6443`.
- `--host 0.0.0.0` binds all interfaces so workers can reach the master. Because this is a non-loopback bind, the REST API switches to **HTTPS automatically** with an auto-generated self-signed certificate.
- `--advertise-addr 10.0.1.1` is the public address clients dial; it is baked into the API certificate SANs and the printed `helyos login` hint.
- `--dns-mode embedded` starts the Hickory DNS server so deployments are resolvable by name across the cluster. See [Service discovery](/docs/concepts/service-discovery).
- `--master-ip 10.0.1.1` is the node IP handed to containers for DNS configuration in embedded mode.
- `--overlay` enables the WireGuard overlay network (see the warning below).

:::warning 
Overlay networking is experimental

The WireGuard overlay (`--overlay`, `--cluster-cidr`, `--wg-port`) is experimental. Tunnel creation is not yet implemented — the daemon currently only logs the intended overlay setup. CNI plugin support (`helyos setup cni`) is likewise experimental. For production multi-node use today, rely on routable node IPs rather than the overlay. See [Networking](/docs/guides/networking).
:::

### Read the printed join command

On first start in master mode, the daemon generates a **join token** and logs the exact command workers should run:

```text
INFO join token generated — workers can join with:
INFO   helyosd --mode worker --join 0.0.0.0:6444 --token nxa_<64-hex-chars>
```

Copy the token from this line — it is only logged once. Replace the printed host (`0.0.0.0`) with an address your workers can actually reach (for example `10.0.1.1`).

:::warning 
The token is shown only once

The master stores the join token as a **hash**, not in plaintext — so it can never print the original value again. `helyos cluster token show` does **not** reveal the token; it returns an error reminding you that the token is shown only at creation. If you lose the token, generate a fresh one with `helyos cluster token rotate` (see [Rotate the join token](#rotate-the-join-token)) and use the new value.
:::

The join token has the prefix `nxa_` followed by 64 hex characters. This is distinct from the **API bearer token** (prefix `nxa-api_`) that the REST API and the `helyos` CLI use — workers authenticate to the cluster with the join token, not an API token.

## Join workers

On each worker host, run `helyosd` in worker mode pointing at the master's gRPC endpoint (`host:6444`) with the join token:

```bash
helyosd \
  --mode worker \
  --join 10.0.1.1:6444 \
  --token nxa_<64-hex-chars> \
  --overlay
```

- `--join 10.0.1.1:6444` is the master's gRPC address. The port is the master's `--grpc-port` (default `6444`), **not** the REST API port `6443`.
- `--token` is the join token from the master.
- `--overlay` should match the master if you are using the (experimental) overlay.

The worker connects, validates the token, registers itself as a node, and starts its heartbeat loop. Both `--join` and `--token` are required in worker mode; the daemon refuses to start without them.

Verify the worker appeared from the master (or any logged-in client):

```bash
helyos nodes
```

Each node shows its name, role (`Master` or `Worker`), status (`Ready`, `NotReady`, or `Draining`), CPU/memory gauges, pod count, and the age of its last heartbeat. Use `--json` for scripting:

```bash
helyos nodes --json
```

## Cluster security model

Cluster gRPC traffic on port `6444` can run over TLS, and the trust model is intentionally asymmetric:

- **TLS is server-authenticated.** On first start the master generates a CA and a self-signed gRPC certificate. A worker that has been given the master's CA certificate verifies the master against it; there are no per-worker client certificates. This protects against a worker connecting to an impostor master and encrypts the channel.
- **The CA is distributed out-of-band.** A worker enables gRPC TLS only when it finds the master's CA certificate (`grpc-ca.pem`) in its own data directory. You must copy that file from the master to each worker yourself — it is not fetched automatically during join. A worker started without the CA file connects to the master over **plaintext** gRPC. On an untrusted network, provision the CA before joining workers.
- **Workers authenticate with the join token, not a client certificate.** Possession of a valid `nxa_` join token is what authorizes a node to join. The master validates the token on `register`; the persistent heartbeat stream is keyed to the already-registered node.

:::warning 
Protect the join token

Anyone with the join token can register a node in your cluster. Distribute it over a secure channel, and rotate it if it may have leaked (see [Rotate the join token](#rotate-the-join-token)). When the worker has the master's CA and gRPC TLS is in effect, the token is sent over the encrypted channel; if you join workers without provisioning the CA (plaintext gRPC), the token crosses the wire in the clear, so do that only on a trusted network.
:::

This is separate from the REST API's security, which uses bearer tokens and CA pinning. See [Security model](/docs/security/security-model) and [TLS & CA pinning](/docs/security/tls-ca-pinning).

## Heartbeats and rescheduling

Once joined, a worker keeps a bidirectional heartbeat stream open to the master and pings on a fixed interval. The master runs a monitor that scans every worker node on its own interval and acts on stale heartbeats. Master nodes are not monitored via heartbeat.

The timing is fixed in the daemon:

| Event | Interval / threshold |
|---|---|
| Worker sends a heartbeat | every **5 seconds** |
| Master monitor scans all nodes | every **10 seconds** |
| No heartbeat for this long → node marked `NotReady` | **30 seconds** |
| No heartbeat for this long → node considered **dead**, pods rescheduled | **60 seconds** |

What happens when a worker goes silent:

1. **At ~30s** with no heartbeat, the master marks the node `NotReady`. The node is no longer eligible for new scheduling.
2. **At ~60s** with no heartbeat, the master considers the node **dead**. It keeps the node `NotReady`, collects every pod that was running on it, and triggers the orchestrator to **reschedule** those pods onto remaining healthy nodes.

If the worker reconnects before these thresholds, no action is taken — a brief network blip will not move your pods.

:::note 
Workers reconnect automatically

If the heartbeat stream drops, the worker reconnects to the master with exponential backoff. You do not need to restart a worker after a transient network failure; it will re-establish its stream and resume heartbeating.
:::

Rescheduling decisions go through the same [scheduler](/docs/concepts/scheduling) as normal placement (weighted `spread` by default, or `binpack`), so recovered pods land on the best-fit healthy nodes. Restart and crash-loop behavior for the individual pods is unchanged — see [Health & restart](/docs/concepts/health-and-restart).

## Draining a node

Before you take a worker offline for maintenance, **drain** it so the master stops scheduling new pods onto it:

```bash
helyos node drain worker-2
```

This sets the node's status to `Draining`. A draining node is excluded from new scheduling decisions. Draining is also a prerequisite for cleanly removing a node — the master refuses to remove a worker that has not been drained first.

```bash
helyos nodes
# worker-2 now shows status: Draining
```

:::caution 
Drain status is reported by the worker's heartbeat

The master tracks each node's status from its incoming heartbeats, and a running worker currently reports itself as `Ready` on every ping. As a result, marking a *live* worker `Draining` from the master is not sticky — the next heartbeat (within ~5s) flips it back to `Ready`. The reliable decommission path is to stop scheduling, then stop the `helyosd` worker process so it stops heartbeating; once it has gone silent its status is no longer overwritten and `drain` followed by `node rm` will take effect. (A node that is already `NotReady` or fully stopped does not heartbeat, so draining it sticks.)
:::

## Removing a node

Once a node is drained and you no longer need it, remove it from the cluster:

```bash
helyos node rm worker-2
```

The master deletes the node record. For safety, a worker **must be drained first**: removing a worker that is not in `Draining` state returns a conflict error:

```text
node 'worker-2' must be drained before removal (status: Ready)
```

So the reliable decommission sequence is:

```bash
helyos node drain worker-2   # stop scheduling onto it; let workloads settle
# ... stop the helyosd worker process on worker-2 so it stops heartbeating ...
helyos node drain worker-2   # re-issue once it is silent so Draining sticks
helyos node rm worker-2      # remove it from the cluster (must be Draining)
```

Because a live worker reports `Ready` on every heartbeat (see the caution above), stop its `helyosd` process before the final `drain`/`rm` so the `Draining` status is not overwritten.

:::tip
A node the master has already marked `NotReady` (after the 60s dead threshold) is no longer heartbeating, so a `drain` on it sticks. Drain it explicitly before calling `helyos node rm` so the removal is accepted.
:::

## Rotate the join token

Rotate the join token whenever it may have been exposed, or on a routine cadence:

```bash
helyos cluster token rotate
```

This generates a new `nxa_` token on the master and prints it once. Already-joined workers are unaffected — rotation changes the token the master accepts for **new** joins; existing nodes stay registered and keep heartbeating. From this point on, new workers must use the new token.

Because the token is stored only as a hash, rotation is also the *only* way to recover from a lost token — there is no command that reveals the current value. `helyos cluster token show` exists, but it intentionally returns an error rather than the secret.

:::warning 
Save the new token

Like the original, a rotated token is shown once. Capture it from the command output and distribute it securely before bringing up new workers.
:::

## A complete two-node example

```bash
# --- On the master (10.0.1.1) ---
helyosd \
  --mode master \
  --host 0.0.0.0 \
  --advertise-addr 10.0.1.1 \
  --dns-mode embedded \
  --master-ip 10.0.1.1
# Log prints:
#   helyosd --mode worker --join 0.0.0.0:6444 --token nxa_abc123...

# --- On the worker (10.0.1.2) ---
helyosd \
  --mode worker \
  --join 10.0.1.1:6444 \
  --token nxa_abc123...

# --- From any logged-in client ---
helyos nodes          # both nodes should be Ready
helyos deploy app.yaml
helyos pods           # pods land on the Ready worker node
```

To deploy across the cluster, just `helyos deploy` as usual — the scheduler places pods on `Ready` **worker** nodes. The master coordinates the cluster and only runs containers itself as a fallback when no eligible worker is available. See [Deploy a service](/docs/guides/deploy-a-service).

## Reference

- Worker heartbeat: every 5s; monitor scan: every 10s; `NotReady` at 30s; dead/reschedule at 60s.
- Join token prefix `nxa_` (64 hex chars); API token prefix `nxa-api_`.
- gRPC cluster port default `6444` (`--grpc-port`); REST API port default `6443`.
- Cluster TLS is server-authenticated; workers authenticate with the join token.
- A worker must be in `Draining` state before `helyos node rm` will remove it.

## Next steps

- [Scheduling](/docs/concepts/scheduling) — how the weighted scheduler places and reschedules pods.
- [Service discovery](/docs/concepts/service-discovery) — embedded DNS for `<deployment>.<project>.internal`.
- [Remote access](/docs/guides/remote-access) — `helyos login`, contexts, and driving the cluster from anywhere.
- [Networking](/docs/guides/networking) — per-project networks and the experimental overlay.

## See also

- [Daemon flags](/docs/reference/daemon-flags) — full `helyosd` flag reference.
- [CLI reference](/docs/reference/cli) — `helyos cluster` and `helyos node` commands.
- [REST API](/docs/reference/rest-api) — `/api/v1/cluster/*` and `/api/v1/nodes/*` endpoints.
- [Security model](/docs/security/security-model) — tokens, TLS, and the secure-by-default posture.
