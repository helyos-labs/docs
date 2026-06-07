---
sidebar_position: 2
title: "Repositories"
description: A map of the helyos-labs repositories — the meta repo, core library, daemon, CLI, and docs — and how they depend on one another.
---

# Repositories

Helyos is a multi-repo project under the [`helyos-labs`](https://github.com/helyos-labs) GitHub organization. Rather than a single monolith, it is split into a small library crate, two binaries, a meta repo, and this documentation site. Everything is licensed under Apache-2.0.

The project ships **two binaries** — `helyosd` (the daemon) and `helyos` (the CLI) — built on top of a shared **library crate**, `helyos-core`. This page maps out each repository, its current version, and how the pieces fit together.

## The repositories

| Repository | Role | Crate / artifact | Version | Link |
|:--|:--|:--|:--|:--|
| `helyos` | Meta repo — README, install script, deploy manifests, and project docs | _(no crate)_ | — | [helyos-labs/helyos](https://github.com/helyos-labs/helyos) |
| `helyos-core` | Library — domain models, port traits, and the actor-model orchestrator | `helyos-core` (lib) | `0.1.7` | [helyos-labs/helyos-core](https://github.com/helyos-labs/helyos-core) |
| `helyosd` | Daemon — runtime adapters, REST API, clustering | `helyosd` (bin + lib) | `0.3.2` | [helyos-labs/helyosd](https://github.com/helyos-labs/helyosd) |
| `helyos-cli` | CLI — deploy, scale, and manage from the terminal | `helyos-cli` → `helyos` (bin) | `0.3.0` | [helyos-labs/helyos-cli](https://github.com/helyos-labs/helyos-cli) |
| `docs` | This documentation site (Docusaurus) | _(no crate)_ | — | [helyos-labs/helyos](https://github.com/helyos-labs/helyos) |

:::note
The binary names differ from their crate names. The `helyos-cli` crate produces a binary called `helyos`, and the `helyosd` crate produces a binary called `helyosd` (plus a library target reused by its own tests). The documentation lives alongside the meta repo content.
:::

## What each repository does

### `helyos` — meta repo

The top-level repo is the front door to the project. It holds the project README, the one-line installer (`install.sh`), deployment manifests, contribution guidelines, and the source for this documentation site. It contains no crate of its own — it points to the other repositories.

Install both binaries from here:

```bash
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh
```

### `helyos-core` — the library

`helyos-core` defines the shared domain model, the port traits, and the actor-based orchestrator that power the platform. It is a **library crate with no binary**, consumed by both `helyosd` and `helyos-cli`.

It provides:

- **Domain models** — `Project`, `Deployment`, `Pod`, `Node`, `Route`, `Certificate`, and more, with full serde support.
- **Port traits** (hexagonal architecture) — `ContainerRuntime` (14 methods), `StateStore`, `SecretStore`, `ClusterTransport`, `DnsProvider`, `RouteStore`, `ProxyBackend`, and a metrics port.
- **Actor-model orchestrator** — an async command loop over `mpsc`/`oneshot` channels with 24 command variants (deploy, scale, stop, projects, secrets, routes, health, scheduling).
- **YAML deployment spec** parsing and validation, the weighted scheduler, the health state machine, and restart policies (`always`, `onfailure`, `never`).

Because the ports are defined here as traits, the orchestration logic is decoupled from any specific container runtime, database, or transport — the daemon supplies the concrete adapters.

### `helyosd` — the daemon

`helyosd` is the server component. It provides concrete **adapter** implementations for every `helyos-core` port trait, exposes the REST API on port `6443`, and runs in single-node, master, or worker mode (clustering over gRPC). With the default `--tls auto`, the daemon serves HTTPS automatically for any non-loopback bind and plain HTTP for a local loopback setup.

Notable adapters include:

- `DockerRuntime` (via `bollard`) and `ContainerdRuntime` (via the `ctr` CLI) for the `ContainerRuntime` port.
- `SqliteStore` (`sqlx` + migrations) for the `StateStore` port.
- `EncryptedSqliteSecretStore` (AES-256-GCM) for the `SecretStore` port.
- A gRPC `ClusterTransport` (`tonic` + `prost`), Hickory-based DNS, and Traefik / nginx / Caddy proxy backends.

Start it with no flags for a zero-config local setup:

```bash
helyosd
```

### `helyos-cli` — the CLI

`helyos-cli` builds the `helyos` binary — the command-line interface developers use day to day. It talks to a running `helyosd` daemon over HTTPS and covers projects, deployments, scaling, secrets, routing, clustering, and node operations, plus kubectl-style `login` and named connection contexts for working against one or many clusters.

```bash
helyos deploy app.yaml
helyos status
helyos scale api 10
```

### `docs` — this site

The documentation you are reading is built with Docusaurus and maintained alongside the meta repo. It is the canonical reference for installation, concepts, guides, and the CLI / REST API / daemon-flag references.

## How the repositories depend on each other

The dependency graph is deliberately simple. `helyos-core` sits at the bottom as the shared library; both binaries depend on it. The binaries do **not** depend on each other — the CLI communicates with the daemon at runtime over HTTPS, not as a compile-time dependency.

```text
            ┌─────────────────┐         ┌─────────────────┐
            │     helyosd      │         │   helyos-cli     │
            │    (daemon)      │         │  (CLI: helyos)   │
            └────────┬────────┘         └────────┬────────┘
                     │                            │
                     │  depends on (Cargo)        │
                     └──────────────┬─────────────┘
                                    ▼
                         ┌─────────────────┐
                         │   helyos-core    │
                         │    (library)     │
                         └─────────────────┘

  Runtime (not a build dep):  helyos  ── HTTPS REST :6443 ──▶  helyosd
```

Both binaries pin `helyos-core` by git tag in their `Cargo.toml`:

```toml
helyos-core = { git = "https://github.com/helyos-labs/helyos-core", tag = "v0.1.7" }
```

:::info
The two binaries share types through `helyos-core`, so the request/response models the CLI sends are the same domain types the daemon understands. There is no compile-time link between `helyos-cli` and `helyosd` — they are coupled only by the REST API contract and the shared core crate.
:::

### Versioning

Each repository is versioned and released independently:

- `helyos-core` — `0.1.7`
- `helyosd` — `0.3.2`
- `helyos-cli` — `0.3.0`

The daemon and CLI advance on their own cadence, pinning the exact `helyos-core` tag they were built against. When `helyos-core` cuts a new tag, the binaries bump their dependency in a follow-up change.

## Toolchain and CI

All three crates use **Rust edition 2024**. The minimum supported Rust version is **1.85** for `helyos-core` and `helyos-cli`; `helyosd` requires **1.88**.

Each repository runs its own CI pipeline. Before opening a pull request, make sure the standard checks pass locally:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

:::tip
CI enforces `cargo fmt --check`, so run `cargo fmt` before pushing — an unformatted diff fails the build even when everything compiles and the tests pass.
:::

## Next steps

- [Architecture deep dive](/docs/project/architecture-deep-dive) — how the ports-and-adapters design and orchestrator work internally.
- [Contributing](/docs/project/contributing) — how to set up a dev environment and submit changes.
- [Architecture overview](/docs/introduction/architecture) — a higher-level tour of the system.
