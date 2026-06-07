---
sidebar_position: 1
title: "What is Helyos?"
description: Helyos is a single-daemon, single-CLI container orchestrator that delivers most of Kubernetes' value with a fraction of its complexity.
---

# What is Helyos?

Helyos is a simple distributed container orchestrator written in Rust. It runs containers, scales them across nodes, gives you automatic TLS and service discovery, and stops there — deliberately. The tagline says it best: **80% of Kubernetes use-cases with 20% of the complexity.**

## The problem

Kubernetes is powerful, but the operational surface area is enormous. To run a handful of services you end up dealing with etcd, kubelet, kube-proxy, CRDs, operators, Helm charts, ingress controllers, cert-manager, and YAML that generates more YAML. For most teams, that is far more infrastructure than the workload actually requires — and far more to learn, secure, and keep running.

Helyos exists for the teams who feel that mismatch. If you want to deploy containers, scale them, expose them over HTTPS, and move on with your day, you should not need a dedicated platform team to do it.

## What Helyos is

Helyos is two binaries and nothing else to install:

- **`helyosd`** — the daemon. It is the orchestration engine: it talks to your container runtime (Docker or containerd), persists state in an embedded SQLite database, exposes an HTTPS REST API, and coordinates clustering, scheduling, health checks, routing, and DNS.
- **`helyos`** — the CLI. A kubectl-style command-line tool that talks to `helyosd` over HTTPS, with named connection contexts so you can manage one or many clusters from your terminal.

There is no external database, no separate control-plane components, and no add-ons to wire together. State lives in SQLite, secrets are encrypted at rest, and the API is HTTPS by default.

```bash
# Install both binaries, register an auto-start service, and launch the daemon
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh
```

Once the daemon is running, deploying a service is a YAML file and one command:

```yaml
# app.yaml
project: myapp

deployment:
  name: api

replicas: 3
image: ghcr.io/company/api:latest

ports:
  - 3000

network:
  public: true
  domain: api.example.com
  https: true

healthcheck:
  path: /health
  interval: 10s
```

```bash
helyos deploy app.yaml
helyos status        # cluster overview
helyos scale api 10  # scale to 10 replicas
helyos logs api      # stream logs
```

:::tip Zero-config locally
On first start, `helyosd` generates an API token, prints it once, and writes a ready-to-use CLI context to `~/.helyos/config.toml`. Run the daemon, and the `helyos` CLI just works locally — no flags, no setup.
:::

## Who it is for

Helyos is a good fit if you are:

- A solo developer or small team that wants real orchestration without a steep learning curve.
- A startup running a handful of services and a few nodes, not a thousand-pod fleet.
- Anyone who has tried Kubernetes for a modest workload and found the complexity-to-value ratio frustrating.
- A team that values a small, auditable surface area — two Rust binaries, no sprawling control plane.

## Core value proposition

You get the orchestration features that matter most for everyday deployments, with sane defaults and almost no ceremony:

- **One command to deploy.** A simple YAML spec, deployed with `helyos deploy` — no Helm, no Kustomize, no templating engine.
- **Secure by default.** The API serves HTTPS with an auto-generated self-signed certificate, requires bearer-token authentication, and refuses to expose a non-loopback address in the clear.
- **Batteries included.** Built-in reverse proxy, automatic TLS for your apps, service discovery, encrypted secrets, and health checking — no separate ingress controller, DNS server, or secrets manager to bolt on.
- **Scales when you do.** Start single-node, then add worker nodes with one join command when you need more capacity.

## Feature highlights

- **Declarative deployments** — replica scaling, restart policies, resource limits, and volumes from a single YAML spec.
- **Multi-node clustering** — master/worker topology over gRPC with join tokens, heartbeats, and automatic pod rescheduling when a node dies.
- **Weighted scheduling** — `spread` (default) and `binpack` strategies with configurable CPU, memory, load, and failure weights.
- **Automatic TLS for routes** — Let's Encrypt certificates provisioned and renewed automatically for public routes (set `--acme-email`), with a pluggable reverse proxy (Traefik, nginx, or Caddy).
- **Encrypted secrets** — AES-256-GCM encryption at rest with a per-node master key; injected into containers as environment variables.
- **Service discovery** — an embedded DNS server resolves `<deployment>.<project>.internal` when you enable `--dns-mode embedded`.
- **HTTP health checks & restart policies** — HTTP probes with configurable interval, timeout, and retries, plus `always` / `onfailure` / `never` restart policies with exponential backoff and crash-loop detection.
- **Remote, multi-user access** — mint per-user API tokens, pin the daemon's CA with `helyos login`, and switch between clusters using named contexts.
- **Runtime flexibility** — Docker (via bollard) and containerd (via the `ctr` CLI), auto-detected at startup.

:::warning Experimental features
The WireGuard overlay network and CNI plugin support are experimental. Overlay tunnel creation is not yet implemented (it currently only logs), so treat overlay networking as not production-ready. Per-project Docker networks are the supported networking model today.
:::

## What Helyos is not

Helyos is intentionally scoped. It is **not** a drop-in replacement for Kubernetes in every situation, and it does not try to be.

- It does not aim for thousand-node, multi-tenant, highly-customized platform deployments — that is where Kubernetes earns its complexity.
- There are no CRDs, operators, admission controllers, service mesh, or pod security policies. If your workflow depends on those, Helyos is not the tool.
- Health checks are **HTTP probes only** — there is no TCP or exec probe.
- The WireGuard overlay and CNI integration are experimental and should not be relied on in production.

If you genuinely need the full Kubernetes feature set, use Kubernetes. If you have been carrying that weight for a workload that does not justify it, Helyos is built for you. See the [comparison](/docs/introduction/comparison) for a side-by-side breakdown.

## Next steps

- [Quickstart](/docs/getting-started/quickstart) — install Helyos and deploy your first service.
- [Architecture](/docs/introduction/architecture) — how the daemon, CLI, and core library fit together.
- [Comparison](/docs/introduction/comparison) — Helyos vs. Kubernetes, Docker Swarm, and Nomad.
