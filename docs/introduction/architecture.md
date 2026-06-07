---
sidebar_position: 3
title: "How it works"
description: A high-level mental model of Helyos — the helyos CLI, the helyosd daemon, and what happens when you deploy a service.
---

# How it works

Helyos is intentionally small. You drive everything from one command-line tool, `helyos`, which talks to one background service, `helyosd`. There is no external database, no separate scheduler, and no sidecars — just the daemon and the container runtime already on your host.

This page gives you a mental model of how those pieces fit together. You don't need any of it to get started — but it helps to know where things live.

## The big picture

```text
  you ──▶ helyos (CLI) ──HTTPS + token──▶ helyosd (daemon) ──▶ your containers
                                              │
                                              ├─ runs containers   (Docker / containerd)
                                              ├─ stores state       (embedded SQLite)
                                              ├─ service DNS + reverse proxy
                                              ├─ TLS certificates + secrets
                                              └─ clusters multiple nodes
```

The CLI never touches containers, state, or networking directly. It sends a request to a running `helyosd` over a REST API and prints the response. The daemon does all the real work.

## The two pieces

### `helyos` — the CLI

`helyos` is a thin, kubectl-style client. It resolves a server URL and token, sends an HTTP(S) request to the daemon, and renders the response as a table or as JSON (`--json`). It holds no orchestration logic of its own.

Connection settings live in named **contexts** in `~/.helyos/config.toml`, so you can target one cluster or many. `helyosd` writes a local context on first start (local use is zero-config), and `helyos login` adds remote clusters with a pinned CA.

```bash
helyos status              # talk to the active context
helyos --context prod pods # target a specific cluster for one command
```

See the [CLI reference](/docs/reference/cli) and [CLI configuration](/docs/reference/cli-config) for the full surface.

### `helyosd` — the daemon

`helyosd` is the server, and it owns everything: the container runtime, persistent state, secrets, internal DNS, the reverse proxy, TLS, and — when you run more than one node — the cluster. It exposes all of that through a single REST API on port `6443` (HTTPS whenever the daemon is reachable off-localhost; plain HTTP on loopback for zero-config local use), guarded by bearer tokens.

A handful of routes — `/health`, `/metrics`, `/api/v1/version`, and `/api/v1/ca` — are public, so clients can check reachability and pin the CA before they authenticate.

See the [daemon flags reference](/docs/reference/daemon-flags) and [REST API reference](/docs/reference/rest-api).

## Pluggable by design

Each capability the daemon manages — the container runtime, the reverse proxy, internal DNS — sits behind a clean interface, so you can swap one implementation for another without changing anything else:

- **Runtime** — Docker or containerd, auto-detected at startup.
- **Reverse proxy** — Traefik, nginx, or Caddy.
- **DNS** — an embedded resolver, with a Docker-DNS fallback.

State always lives in an embedded SQLite database, and secrets are encrypted at rest. There is nothing extra to install or operate.

## How a deploy flows through the system

Here is what happens when you run `helyos deploy app.yaml`:

1. The **CLI** parses your YAML into a deployment spec and sends it to `helyosd` over the REST API, with your bearer token.
2. The **daemon** decides where to place each replica, then pulls the image, creates the containers, and records the deployment in its state store.
3. It registers internal **DNS** names for the service, injects any **secrets**, and programs any public **route** into the reverse proxy (requesting a Let's Encrypt certificate when needed).
4. In a cluster, replicas assigned to other nodes are dispatched to those workers, which run them locally.
5. A background **health** runner probes each pod and applies your restart policy if something goes wrong.

```bash
helyos deploy app.yaml
helyos status      # cluster overview
helyos pods        # running containers
```

## Next steps

- [Installation](/docs/getting-started/installation) — install `helyosd` and `helyos`.
- [Quickstart](/docs/getting-started/quickstart) — deploy your first service.
- [Deployment spec reference](/docs/reference/deployment-spec) — the YAML format in full.
