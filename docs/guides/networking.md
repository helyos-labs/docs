---
sidebar_position: 7
title: "Networking"
description: How Helyos wires up container networking — per-project Docker networks today, with experimental WireGuard overlay and CNI support on the roadmap.
---

# Networking

Helyos keeps networking deliberately simple. On a single node, every project gets its own Docker network and containers talk to each other directly. Beyond that, Helyos has the foundations for a multi-node overlay network and CNI-based networking — but those pieces are experimental and not yet production-ready.

This page covers what works today (per-project Docker networks) and what is still under construction (the WireGuard overlay and CNI plugins).

## Per-project networks

When you deploy into a project, Helyos creates a dedicated container network for that project on demand. With the Docker runtime, this is a standard `bridge` network named `helyos-<project>` and labeled `managed-by=helyos`. Every pod in the project is attached to it, so deployments in the same project can reach each other, while pods in different projects are isolated on separate networks.

For example, deploying into the `myapp` project creates a network like this:

```bash
docker network ls --filter label=managed-by=helyos
# NETWORK ID     NAME            DRIVER    SCOPE
# a1b2c3d4e5f6   helyos-myapp    bridge    local
```

Network creation is idempotent — Helyos only creates the network if it does not already exist, and reuses it for every subsequent deployment in the project.

:::note
Per-project isolation is per project, not per deployment. All deployments within a single project share one network, which is exactly what makes [service discovery](/docs/concepts/service-discovery) inside a project straightforward.
:::

### Reaching services by name

Inside a project, you don't address pods by IP — you use DNS names. With the embedded DNS server enabled (`--dns-mode embedded`), Helyos resolves:

```text
<deployment>.<project>.internal        # the deployment (load-balanced across pods)
<deployment>-<n>.<project>.internal    # an individual pod
```

On a single node with the default `noop` DNS mode, containers use Docker's built-in DNS on the shared project network instead. See [Service discovery](/docs/concepts/service-discovery) for the full picture.

### Exposing services externally

Per-project networks are internal. To make a deployment reachable from outside the cluster, you publish ports and/or add a route through the built-in reverse proxy:

```yaml
# app.yaml
project: myapp

deployment:
  name: api

image: ghcr.io/company/api:latest
ports:
  - 3000

network:
  public: true
  domain: api.example.com
  https: true
```

The `network` block on a deployment controls public exposure and routing, not the overlay. See [Routing](/docs/guides/routing) and [TLS](/docs/guides/tls) for how `public`, `domain`, and `https` work, and the [Deployment spec reference](/docs/reference/deployment-spec) for every field.

## WireGuard overlay (experimental)

For multi-node clusters, Helyos is designed to run an encrypted overlay network so pods on different hosts can talk to each other over a private mesh. The building blocks — key generation, peer configuration, and CIDR allocation — exist in the codebase, but they are not finished and are not yet wired into the daemon's startup.

:::warning Experimental — not production-ready
The WireGuard overlay is **experimental** and currently **inert**. The overlay flags (`--overlay`, `--cluster-cidr`, `--wg-port`) are accepted by the daemon, but they are not yet consumed: no WireGuard manager is started, no keypair is generated, and no tunnel — kernel or userspace — is brought up. Do not rely on the overlay for cross-node pod networking. Treat it as a placeholder for a feature still under construction, and expect behavior to change.
:::

### Enabling the overlay

The overlay is off by default. Three daemon flags are reserved for it:

```bash
helyosd --mode master \
  --overlay \
  --cluster-cidr 172.20.0.0/16 \
  --wg-port 51820
```

| Flag | Default | Purpose |
|---|---|---|
| `--overlay` | off | Intended to enable the WireGuard overlay network (currently a no-op flag). |
| `--cluster-cidr <CIDR>` | `172.20.0.0/16` | Address range the overlay is designed to carve node subnets out of. |
| `--wg-port <PORT>` | `51820` | UDP port WireGuard is designed to listen on. |

The intended design is a full mesh: each node generates an X25519 keypair, advertises its public key, and prepares peer configuration with a 25-second persistent keepalive so that every node's subnet is reachable through its peer.

### What actually happens today

Right now, nothing — the overlay flags are parsed but never read. The WireGuard module (`boringtun` userspace mode, X25519 keypair generation, peer configuration with a 25-second keepalive) exists in the daemon's source, but it is not instantiated during startup, so enabling `--overlay` does not generate a keypair, log a tunnel, or bring up any interface. The `create_tunnel` path itself only logs even when called, and it is not called.

For real multi-node connectivity right now, place your nodes on a network where their gRPC and published ports are mutually reachable (for example a private subnet or VPN you manage yourself), and rely on per-project networks plus published ports.

:::tip
Multi-node clustering itself (master/worker over gRPC, heartbeats, rescheduling) works independently of the overlay — see [Clustering](/docs/guides/clustering). The overlay is only about pod-to-pod networking across hosts, which is the part still in progress.
:::

## CNI plugins (experimental)

When you run Helyos on the containerd runtime, container networking is handled through the [Container Network Interface (CNI)](https://www.cni.dev/). Helyos can generate CNI network configurations and ships a helper to install the standard plugin binaries — but, like the overlay, the attach/detach path is not complete.

:::warning Experimental — not production-ready
CNI support is **experimental**. Helyos generates valid CNI `conflist` files and allocates per-network subnets, but attaching and detaching containers to those networks is **not yet implemented** (those operations currently return "not yet implemented"). Treat CNI networking as a preview. The Docker runtime is the supported path today.
:::

### Installing CNI plugins

`helyos setup cni` downloads the standard CNI plugins from the [containernetworking/plugins](https://github.com/containernetworking/plugins) releases and installs them, picking the right OS/architecture build automatically.

```bash
# Install with defaults: version 1.4.1 into /var/lib/helyos/cni/bin
helyos setup cni

# Override the install directory and/or version
helyos setup cni --bin-dir /opt/cni/bin --version 1.4.1
```

| Flag | Default | Purpose |
|---|---|---|
| `--bin-dir <DIR>` | `/var/lib/helyos/cni/bin` | Directory to install the plugin binaries into. |
| `--version <VER>` | `1.4.1` | CNI plugins release version to download. |

After extraction, the command marks the binaries executable and verifies that the required plugins — `bridge`, `loopback`, and `host-local` — are present:

```text
Installed 12 CNI plugins to /var/lib/helyos/cni/bin:
  - bandwidth
  - bridge
  - host-local
  - loopback
  ...
All required CNI plugins installed successfully
```

### How CNI networks are modeled

When the daemon needs a network on the containerd runtime, it writes a CNI `conflist` (CNI version `1.0.0`) under `<data-dir>/cni/conf/`, containing a `bridge` plugin (acting as gateway, with `host-local` IPAM) and a `loopback` plugin. Subnets are allocated as `/24` blocks carved sequentially from `172.20.0.0/16` — for example the first network gets `172.20.1.0/24`, the second `172.20.2.0/24`, and so on. Config generation is idempotent and a released network's config file is removed on teardown.

:::note
The subnet allocator hands out octets monotonically and does not reclaim released subnets, so the pool is bounded at 255 `/24` networks. This, together with the unimplemented attach/detach path, is why CNI is still experimental.
:::

## Choosing a setup

| You want… | Use |
|---|---|
| A single node with Docker | Per-project Docker networks — works out of the box, nothing to configure. |
| Multiple nodes that can reach each other on a private network | Clustering with per-project networks and published ports; manage cross-host connectivity yourself for now. |
| Cross-host pod-to-pod overlay | The WireGuard overlay — experimental, not ready for production. |
| containerd-based CNI networking | `helyos setup cni` to install plugins — experimental, Docker is the supported path. |

## Next steps

- [Service discovery](/docs/concepts/service-discovery) — how `<deployment>.<project>.internal` names resolve.
- [Clustering](/docs/guides/clustering) — run a multi-node master/worker cluster.
- [Routing](/docs/guides/routing) — expose deployments through the built-in reverse proxy.
- [Daemon flags](/docs/reference/daemon-flags) — full reference for `--overlay`, `--cluster-cidr`, `--wg-port`, and DNS flags.
- [CLI reference](/docs/reference/cli) — full reference for `helyos setup cni`.

## See also

- [Deployment spec](/docs/reference/deployment-spec) — the `network` block and other deployment fields.
- [How it works](/docs/introduction/architecture) — where networking fits into the daemon.
