---
sidebar_position: 3
title: "Architecture"
description: How Helyos fits together — the helyos CLI, the helyosd daemon, and the helyos-core library, built on a hexagonal (ports and adapters) design.
---

# Architecture

Helyos is intentionally small: a single CLI (`helyos`), a single daemon (`helyosd`), and one shared library (`helyos-core`). This page gives you a high-level mental model of how those pieces fit together. For an in-depth walkthrough — actor channels, scheduler internals, the cluster gRPC protocol — see the [architecture deep-dive](/docs/project/architecture-deep-dive).

## The big picture

You drive Helyos from the `helyos` CLI. The CLI never touches containers, state, or networking directly — it speaks to a running `helyosd` daemon over a REST API (HTTPS on any non-loopback bind; plain HTTP on loopback for zero-config local use), authenticated with a bearer token. The daemon does all the real work: it runs an in-process orchestrator and a set of adapters that talk to the container runtime, persistent state, secrets, DNS, the reverse proxy, and (in a cluster) other nodes.

```text
+----------------------+
|     helyos (CLI)     |   kubectl-style commands, named contexts, --json
+----------+-----------+
           |  HTTPS (remote) / HTTP (loopback) + Bearer token  (REST API on :6443)
           v
+-----------------------------------------------------------+
|  helyosd (daemon)                                         |
|                                                           |
|  +------------------+      +---------------------------+  |
|  |   REST API       |      |   gRPC cluster server     |  |
|  |   (axum :6443)   |      |   (tonic :6444, TLS)      |  |
|  +--------+---------+      +-------------+-------------+  |
|           |                              |                |
|           v                              v                |
|  +--------------------------------------------------+     |
|  |        Orchestrator  (actor loop)                |     |
|  |   mpsc/oneshot channels -- 24 command variants   |     |
|  +--+------+-------+--------+--------+--------+------+     |
|     |      |       |        |        |        |           |
|     v      v       v        v        v        v           |
|  +-----+ +-----+ +------+ +-----+ +-------+ +---------+   |
|  |Runtime| |State| |Secret| | DNS | | Proxy | |Cluster |  |
|  |adapter| |store| |store | |     | |backend| |transport| |
|  +-----+ +-----+ +------+ +-----+ +-------+ +---------+   |
|  Docker/  SQLite  AES-GCM  Hickory traefik/  gRPC        |
|  contnrd          SQLite   DNS     nginx/    (tonic)     |
|                                    caddy                 |
+-----------------------------------------------------------+
        |          |          |           |
        v          v          v           v
   containers   ~/.helyos   embedded    other helyosd
   (Docker/     /data       DNS +       nodes (master/
   containerd)  (SQLite)    reverse     worker)
                            proxy
```

Everything below the REST API lives inside the single `helyosd` process. There is no external etcd, no separate scheduler, no sidecar — just the daemon and the container runtime already on the host.

## The three pieces

### `helyos` — the CLI

The CLI is a thin, kubectl-style client. It resolves a server URL and token, sends an HTTP(S) request to `helyosd`, and renders the response as a table or as JSON (`--json`). It holds no orchestration logic of its own.

Connection settings live in named **contexts** in `~/.helyos/config.toml`, so you can target one or many clusters. `helyosd` writes a local context on first start (so local use is zero-config), and `helyos login` adds remote ones with a pinned CA.

```bash
helyos status              # talk to the active context
helyos --context prod pods # target a specific cluster for one command
```

See the [CLI reference](/docs/reference/cli) and [CLI configuration](/docs/reference/cli-config) for the full surface.

### `helyosd` — the daemon

`helyosd` is the server. It owns all state and side effects, and exposes them through two transports:

- A **REST API** (axum, port `6443`, HTTPS on any non-loopback bind; plain HTTP on loopback) that the CLI and any HTTP client use. Most routes require a bearer token; `/health`, `/metrics`, `/api/v1/version`, and `/api/v1/ca` are public so clients can probe reachability and pin the CA before authenticating.
- A **gRPC cluster server** (tonic, port `6444`, TLS) used only when running in a cluster, so workers can register, send heartbeats, and receive pod assignments.

Inside the process, an **actor-model orchestrator** receives commands over `mpsc`/`oneshot` channels (24 command variants — deploy, scale, stop, projects, secrets, routes, health, scheduling) and drives the adapters. Routing all mutations through one actor keeps state changes serialized and free of locks.

See the [daemon flags reference](/docs/reference/daemon-flags) and [REST API reference](/docs/reference/rest-api).

### `helyos-core` — the shared library

`helyos-core` is a library crate (no binary) shared by both the CLI and the daemon. It defines:

- **Domain models** — `Project`, `Deployment`, `Pod`, `Node`, `Route`, `Certificate`, and related types.
- **The orchestrator** — the actor loop and the `OrchestratorHandle` used to talk to it.
- **Port traits** — the interfaces the orchestrator depends on (see below).
- **The deployment spec parser** — the YAML format you write for `helyos deploy`, with validation.
- **The scheduler, health tracker, and restart logic** — weighted spread/bin-pack scheduling, HTTP health probes, and `always`/`onfailure`/`never` restart policies with exponential backoff.

Because the domain logic lives in a library, it is fully unit-tested in isolation and is reused identically by the daemon at runtime.

## Hexagonal design (ports and adapters)

Helyos follows a **hexagonal architecture** — also called ports and adapters. The orchestrator and domain logic in `helyos-core` depend only on a set of trait interfaces (the *ports*); they never reference a concrete implementation. The daemon supplies the production *adapters* that implement those ports.

The ports defined in `helyos-core`:

| Port (trait) | Responsibility |
|---|---|
| `ContainerRuntime` | Create, start, stop, inspect containers and networks (14 methods) |
| `StateStore` | Persist projects, deployments, pods, nodes, and cluster config |
| `SecretStore` | Store and retrieve encrypted secrets |
| `ClusterTransport` | Register nodes, send heartbeats, assign pods across the cluster |
| `DnsProvider` | Register and resolve internal service names |
| `RouteStore` | Persist routes, certificates, and subnet allocations |
| `ProxyBackend` | Apply routes to the reverse proxy and reload it |
| `MetricsPort` | Emit metrics (with a no-op default) |

The adapters that `helyosd` plugs in:

| Port | Adapter | Backed by |
|---|---|---|
| `ContainerRuntime` | `DockerRuntime` / `ContainerdRuntime` | bollard (Docker API) / `ctr` CLI |
| `StateStore` | `SqliteStore` | SQLite via sqlx with migrations |
| `SecretStore` | `EncryptedSqliteSecretStore` | AES-256-GCM, rusqlite |
| `ClusterTransport` | gRPC client/server / `LocalTransport` | tonic + prost (TLS) / single-node passthrough |
| `DnsProvider` | `HickoryDnsProvider` / `NoopDnsProvider` | embedded Hickory DNS / Docker DNS fallback |
| `ProxyBackend` | `TraefikBackend` / `NginxBackend` / `CaddyBackend` | generated config + reload |

:::tip Why this matters to you
Ports and adapters are what let Helyos swap Docker for containerd, or Traefik for nginx, with a single flag — no changes to the orchestration logic. It is also why testing is fast: `helyos-core` ships in-memory adapters so the domain logic can be exercised without Docker.
:::

## How a deploy flows through the system

Putting it together, here is what happens when you run `helyos deploy app.yaml`:

1. The **CLI** parses the YAML into a deployment spec and `POST`s it to `helyosd` at `/api/v1/deploy` over the REST API (HTTPS when the daemon is exposed), with your bearer token.
2. The **REST API** authenticates the token and forwards the request to the orchestrator over its command channel.
3. The **orchestrator** asks the scheduler where to place each replica, then drives the adapters: pull the image and create containers via the `ContainerRuntime`, persist the deployment and pods via the `StateStore`, register internal DNS names via the `DnsProvider`, inject secrets from the `SecretStore`, and program any public route into the `ProxyBackend`.
4. In a cluster, replicas assigned to other nodes are dispatched over the **gRPC `ClusterTransport`**, and a worker's local orchestrator runs them there.
5. A background health runner probes each pod over HTTP and feeds results back to the orchestrator, which applies your restart policy.

```bash
helyos deploy app.yaml
helyos status      # cluster overview
helyos pods        # running containers
```

## Next steps

- [Installation](/docs/getting-started/installation) — install `helyosd` and `helyos`.
- [Quickstart](/docs/getting-started/quickstart) — deploy your first service.
- [Deployment spec reference](/docs/reference/deployment-spec) — the YAML format in full.
- [Architecture deep-dive](/docs/project/architecture-deep-dive) — actor channels, scheduler internals, and the cluster protocol.
- [Repositories](/docs/project/repositories) — where `helyos-core`, `helyosd`, and `helyos-cli` live.
