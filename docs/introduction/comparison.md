---
sidebar_position: 2
title: "Helyos vs. Kubernetes, Swarm & Nomad"
description: An honest comparison of Helyos with Kubernetes, Docker Swarm, and HashiCorp Nomad — and guidance on when to pick which.
---

# Helyos vs. Kubernetes, Swarm & Nomad

Helyos is not trying to replace Kubernetes for everyone. It targets a specific point on the spectrum: teams who want declarative, multi-node container orchestration with built-in TLS, DNS, and routing — without standing up and operating a full Kubernetes control plane. The tagline says it plainly: **80% of Kubernetes use-cases with 20% of the complexity.**

This page lays out the trade-offs honestly. Each tool here is excellent at what it was designed for. The goal is to help you choose the right one, not to talk you out of any of them.

## At a glance

| | Helyos | Kubernetes | Docker Swarm | Nomad |
|---|:---:|:---:|:---:|:---:|
| Binaries to install | **2** (`helyosd` + `helyos`) | 5+ (apiserver, etcd, kubelet, kube-proxy, scheduler, …) | 1 (Docker Engine) | 1 (`nomad`) |
| External dependencies | **None** (SQLite embedded) | etcd, container runtime, CNI | Docker Engine | Consul/Vault (optional but common) |
| Config language | **YAML** | YAML (+ Helm / Kustomize in practice) | YAML (Compose) | HCL |
| Built-in TLS for your apps | **Yes** (ACME, auto-renew) | No — add cert-manager + ingress | No | No — typically Vault + a proxy |
| Built-in service discovery / DNS | **Yes** (embedded Hickory DNS) | CoreDNS (deployed separately) | Yes (internal DNS) | Consul (separate) |
| Built-in reverse proxy / routing | **Yes** (Traefik / nginx / Caddy) | No — add an ingress controller | Routing mesh | No — add a proxy |
| Encrypted secrets | **Yes** (AES-256-GCM at rest) | Yes (base64 by default; encrypt-at-rest is opt-in) | Yes | Via Vault |
| Learning curve | **Hours** | Weeks to months | Days | Days |
| Written in | **Rust** | Go | Go | Go |
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | BUSL-1.1 |

:::note
"Built-in" here means it ships and is configured in the box. Kubernetes can do everything in this table — but most capabilities are add-ons you install, version, and operate yourself. That flexibility is the point of Kubernetes; it is also where the operational cost comes from.
:::

## Where Helyos fits

Helyos is two static binaries with no external datastore. The daemon (`helyosd`) keeps all state in an embedded SQLite database, so there is no etcd cluster to run, back up, or repair. It auto-detects Docker or containerd at startup, generates its own API token and self-signed TLS certificate on first run, and writes a local CLI context so the `helyos` CLI works immediately — no kubeconfig wrangling.

```bash
# Install the daemon and CLI, set up an auto-start service, and launch
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh

# Deploy a service
helyos deploy app.yaml
helyos status
helyos scale api 5
```

A Helyos deployment spec is intentionally small. There is no templating engine and no chart repository — the file you write is the file the daemon reads:

```yaml
project: ecommerce

deployment:
  name: api

replicas: 3
image: ghcr.io/company/api:latest

ports:
  - 3000

network:
  public: true
  domain: api.example.com
  https: true          # ACME-issued, auto-renewed

healthcheck:
  path: /health
  interval: 10s

restart: onfailure     # always | onfailure | never
```

See the full schema in the [deployment spec reference](/docs/reference/deployment-spec).

## When to choose Helyos

Helyos is a strong fit when:

- **You want orchestration without operating a control plane.** No etcd, no separate ingress controller, no cert-manager, no CoreDNS deployment. TLS, DNS, routing, and secrets are built in and on by default.
- **Your topology is a handful of nodes**, not hundreds. A master/worker cluster joins over gRPC with a single join token, and dead nodes trigger automatic pod rescheduling.
- **You value time-to-first-deploy.** The learning curve is measured in hours: a few CLI verbs (`deploy`, `scale`, `logs`, `route add`) and one small YAML file.
- **You want secure-by-default networking out of the box.** When the daemon binds a non-loopback address, the API is HTTPS with a self-signed cert, and a plain-HTTP bind on a public address is refused unless you explicitly opt in. Public app routes get Let's Encrypt certificates automatically.
- **A single dependency-free binary is a feature** — for edge boxes, homelabs, internal tools, small SaaS backends, and CI environments.

```bash
# Multi-node is two commands
helyosd --mode master                       # prints a join command
helyosd --mode worker --join 10.0.1.1:6444 --token <TOKEN>
```

## When to choose Kubernetes instead

Kubernetes is the right tool — and Helyos is the wrong one — when you need any of the following:

- **A large, vibrant ecosystem.** Operators, CRDs, Helm charts, service meshes (Istio/Linkerd), GitOps controllers (Argo CD/Flux), autoscalers (HPA/VPA/Cluster Autoscaler), and managed offerings on every cloud (EKS/GKE/AKS). Helyos deliberately has a small, fixed feature set and no plugin ecosystem.
- **Fine-grained primitives and extensibility.** StatefulSets, DaemonSets, Jobs/CronJobs, custom controllers, admission webhooks, pod security standards, NetworkPolicies, and arbitrary `Custom Resource Definitions`. Helyos models projects, deployments, and pods — and nothing more.
- **Massive scale and heterogeneous workloads** across many teams, namespaces, and clusters with sophisticated RBAC and multi-tenancy. Helyos offers API tokens and project isolation, not full RBAC.
- **A managed control plane.** If you would rather a cloud provider run the control plane for you, a hosted Kubernetes service removes most of the operational burden that Helyos avoids by being small.

In short: if you are already standing up a platform team, investing in the CNCF ecosystem, or running at a scale where the control-plane overhead pays for itself, Kubernetes is the better choice.

## How Helyos compares to Docker Swarm

Docker Swarm and Helyos share a philosophy: simple, fast to start, batteries included. The differences:

- **No Docker daemon lock-in.** Helyos supports both Docker and containerd and auto-detects which is present. Swarm is part of Docker Engine.
- **Built-in ACME TLS and pluggable proxy backends.** Swarm has a routing mesh and internal DNS, but automatic per-route Let's Encrypt certificates are not part of the box — you add a proxy like Traefik yourself. Helyos ships Traefik (default), nginx, and Caddy backends and provisions certificates automatically.
- **Active development.** Swarm is stable but largely in maintenance mode. Helyos is actively developed.

If your team already lives in `docker compose` and runs a few nodes, Swarm is a perfectly reasonable choice. Helyos gives you the same low-friction feel plus built-in routing TLS and runtime flexibility.

## How Helyos compares to Nomad

Nomad is a flexible, single-binary scheduler that orchestrates more than just containers (it also runs raw executables, Java, QEMU VMs, and more). Compared to Helyos:

- **Scope.** Nomad is a general-purpose workload scheduler; Helyos is focused specifically on containers, with networking, DNS, routing, and TLS opinionated and built in.
- **Configuration.** Nomad uses HCL job specs; Helyos uses a small YAML spec.
- **Companion services.** Nomad commonly pairs with Consul for service discovery and Vault for secrets. Helyos bundles equivalents (embedded DNS, AES-256-GCM secrets) so there is nothing extra to deploy.
- **Licensing.** Nomad moved to the BUSL-1.1 license; Helyos is Apache-2.0.

Choose Nomad when you need to schedule mixed (non-container) workloads or want HashiCorp's broader ecosystem. Choose Helyos when your workloads are containers and you want the networking and security pieces included rather than assembled.

## Honest limitations of Helyos

To be fair, here is where Helyos is genuinely less capable today:

:::warning Experimental features
The **WireGuard overlay network** and **CNI plugin support** are experimental and not production-ready. Overlay tunnel creation is not yet implemented (it currently only logs). Plan around per-project Docker networks for now, and treat overlay/CNI as preview features.
:::

- **No plugin ecosystem.** What ships is what you get. There are no operators, CRDs, or third-party controllers.
- **HTTP health probes only.** Health checks are HTTP `GET <path>` probes — there is no TCP or exec probe.
- **Smaller scale envelope.** Helyos targets small clusters, not hundreds of nodes or thousands of services.
- **No managed offering.** You run `helyosd` yourself (the installer sets up an auto-start service to make that easy).
- **Cluster RBAC is coarse.** Authentication is via bearer tokens and project isolation, not Kubernetes-style role-based access control.

These are deliberate trade-offs in service of simplicity. If they are dealbreakers, Kubernetes is likely your answer.

## Summary

| You want… | Reach for |
|---|---|
| The smallest path to multi-node container orchestration with TLS/DNS/proxy built in | **Helyos** |
| A rich ecosystem, extensibility, huge scale, or a managed control plane | **Kubernetes** |
| Compose-style simplicity on Docker Engine | **Docker Swarm** |
| A general-purpose scheduler for mixed (non-container) workloads | **Nomad** |

## Next steps

- [What is Helyos?](/docs/introduction/what-is-helyos) — the high-level overview
- [Architecture](/docs/introduction/architecture) — how the daemon, CLI, and core library fit together
- [Installation](/docs/getting-started/installation) — get Helyos running in minutes
- [Quickstart](/docs/getting-started/quickstart) — deploy your first service
- [Security model](/docs/security/security-model) — secure-by-default TLS, tokens, and secrets
