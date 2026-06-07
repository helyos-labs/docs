---
sidebar_position: 6
title: "Service Discovery (DNS)"
description: How Helyos resolves deployment and pod names with its embedded Hickory DNS server so your containers can find each other by name.
---

# Service Discovery (DNS)

Service discovery lets one deployment reach another by a stable name instead of a hard-coded IP address. Helyos provides this with an embedded DNS server built on [Hickory DNS](https://github.com/hickory-dns/hickory-dns), so a frontend can call `http://api.ecommerce.internal` and let the daemon resolve it to whichever pods are currently running.

There is no separate component to install — no CoreDNS, no service mesh. The DNS server lives inside the daemon, registers a record whenever a pod starts, and removes it when the pod stops.

## DNS names

Every deployment is reachable on a name in the `.internal` zone, scoped to its project:

```text
<deployment>.<project>.internal
```

For a deployment named `api` in the project `ecommerce`, that name is:

```text
api.ecommerce.internal
```

This name resolves to **every running pod** of that deployment. A pod's IP is registered the moment its container starts and gets an address, and removed when the pod is stopped, scaled away, or replaced — so the answer set reflects the pods that are currently registered, not a separate health gate. When you scale up or down, that set changes automatically, so DNS doubles as basic client-side load balancing across replicas.

### Per-pod names

Each individual pod also gets its own name, using the replica index (starting at `0`):

```text
<deployment>-<n>.<project>.internal
```

So the second replica of `api` in `ecommerce` is:

```text
api-1.ecommerce.internal
```

Per-pod names are useful when a workload needs to address a specific instance — for example a stateful service that pins clients to a particular member. Indexes are positional over the currently registered IPs, so prefer the deployment-wide name unless you have a concrete reason to target one pod.

:::note

Names are scoped per project. `api.ecommerce.internal` and `api.billing.internal` are entirely separate, even though both deployments are called `api`. There is no cross-project resolution.

:::

## Enabling embedded DNS

Service discovery is **off by default**. The daemon's `--dns-mode` flag defaults to `noop`, in which case the DNS provider does nothing and containers rely on the container runtime's own DNS (for example Docker's per-network DNS on a single node).

To turn on the embedded resolver, start the daemon with `--dns-mode embedded`:

```bash
helyosd --dns-mode embedded
```

Related flags:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--dns-mode` | `noop` | `noop` (no embedded DNS) or `embedded` (start the Hickory server) |
| `--dns-listen` | `127.0.0.1:15353` | Address the embedded DNS server binds (UDP and TCP) |
| `--dns-upstream` | `8.8.8.8:53` | Where non-`.internal` queries are forwarded |
| `--master-ip` | _(unset)_ | This node's IP, used to configure containers' DNS in embedded mode |

A fuller example, binding the resolver on a routable address and forwarding to your own upstream:

```bash
helyosd \
  --dns-mode embedded \
  --dns-listen 0.0.0.0:15353 \
  --dns-upstream 1.1.1.1:53 \
  --master-ip 10.0.1.1
```

In a cluster, embedded DNS is the mode you want — single-node setups can usually stay on the `noop` default and let the runtime handle name resolution. See [Clustering](/docs/guides/clustering) for the full multi-node setup.

```bash
# Typical master node in a cluster
helyosd --mode master --dns-mode embedded --master-ip 10.0.1.1 --overlay
```

:::tip

Use `--master-ip` in embedded mode so the daemon advertises the right address to containers. Pods are pointed at the node's DNS server, which is what lets them resolve `.internal` names.

:::

## How resolution works

When the embedded server receives a query, it inspects the name:

1. **`.internal` names** are answered from the daemon's in-memory record store. The server parses the name into `<host>.<project>.internal`. If `<host>` ends in `-<n>` and that index exists, it returns just that pod's IP; otherwise it returns every registered IP for the deployment. A name with no matching records returns `NXDOMAIN`.
2. **Everything else** is forwarded to the configured upstream (`--dns-upstream`) so containers can still resolve public domains like `github.com` through the same resolver.

Records are managed automatically by the daemon. As pods start, their IPs are registered under the deployment; as pods stop, those IPs are deregistered. You never edit DNS records by hand.

:::info

Answers carry a short 60-second TTL, and `A` (IPv4), `AAAA` (IPv6), and `ANY` queries are supported. Because the deployment name returns the full set of current pod IPs, clients that re-resolve will pick up scaling changes without a restart.

:::

## Resolving siblings from a container

Once a deployment is up, other containers in the cluster resolve it by name. From inside a running pod you can target a sibling deployment directly in your application config or with a quick check:

```bash
# Reach a sibling deployment (all replicas)
curl http://api.ecommerce.internal:8080/health

# Reach one specific replica
curl http://api-0.ecommerce.internal:8080/health
```

In application code, just use the name as the host. For example, a web frontend pointing at an `api` deployment in the same `ecommerce` project:

```yaml
project: ecommerce

deployment:
  name: web

image: ghcr.io/example/web:1.4.0
replicas: 2
ports:
  - 8080
env:
  API_URL: "http://api.ecommerce.internal:8080"
```

The port in these examples is the port your container listens on — DNS only resolves the name to IP addresses; it does not remap ports. Make sure the target deployment exposes the port you connect to (see [Deployments & Pods](/docs/concepts/deployments-and-pods) and the [deployment spec](/docs/reference/deployment-spec)).

:::warning

`.internal` names are for **east-west** traffic between deployments inside the cluster. They are not meant to be reachable from the public internet. To expose a service externally, use a public route and a real domain instead — see [Routing](/docs/guides/routing).

:::

## The `noop` default

If you leave `--dns-mode` at its `noop` default, the embedded server is not started and `.internal` names are not registered. Resolution then falls back to whatever the container runtime provides — on Docker, that is the built-in DNS on each per-project network, which already lets containers on the same network reach each other. This is often enough for a single node, which is why `noop` is the default; switch to `embedded` when you want the consistent `.internal` naming scheme or when you run more than one node.

## Next steps

- [Clustering](/docs/guides/clustering) — run multiple nodes, where embedded DNS matters most.
- [Networking](/docs/guides/networking) — per-project networks and the overlay model.
- [Routing](/docs/guides/routing) — expose a deployment to the outside world on a real domain.

## See also

- [Daemon flags](/docs/reference/daemon-flags) — every `--dns-*` flag and its default.
- [Scaling](/docs/concepts/scaling) — how the answer set changes as you add or remove replicas.
- [Deployments & Pods](/docs/concepts/deployments-and-pods) — pods, replicas, and indexes.
