---
sidebar_position: 8
title: "Observability"
description: Monitor a Helyos cluster with Prometheus metrics, the live SSE event stream, and the helyos top dashboard.
---

# Observability

Helyos gives you several ways to see what your cluster is doing: a Prometheus metrics endpoint for long-term monitoring and alerting, a Server-Sent Events (SSE) stream of live cluster activity, and CLI commands (`helyos status`, `helyos top`, node stats) for quick at-a-glance views. This page covers each one and how to wire them into your monitoring stack.

## Prometheus metrics

The daemon exposes metrics in Prometheus text format at `GET /metrics`. This endpoint is **public** — it requires no bearer token — so a Prometheus server can scrape it without credentials.

```bash
# Against a local daemon (loopback stays plain HTTP)
curl http://localhost:6443/metrics

# Against a remote daemon (HTTPS by default)
curl https://cluster.example.com:6443/metrics
```

The response is served as `text/plain; version=0.0.4`, the standard Prometheus exposition format.

:::note

`/metrics` is one of only four public endpoints (alongside `/health`, `/api/v1/version`, and `/api/v1/ca`). Every other API route requires a bearer token. See [API tokens](/docs/security/api-tokens) for the protected endpoints.

:::

### Available metrics

All metrics are prefixed with `helyos_`. Gauges are emitted immediately (initialized to `0`); counters and histograms only appear in the output after the first observation.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `helyos_http_requests_total` | counter | `method`, `path`, `status` | Total HTTP requests served by the API |
| `helyos_http_request_duration_seconds` | histogram | `method`, `path` | HTTP request duration |
| `helyos_container_events_total` | counter | `event` | Container lifecycle events (`started`, `died`, `oom`) |
| `helyos_schedule_duration_seconds` | histogram | `strategy` | Scheduler decision duration |
| `helyos_deployment_ops_total` | counter | `op` | Deployment operations (deploy, scale, …) |
| `helyos_nodes_total` | gauge | — | Current number of cluster nodes |
| `helyos_pods_total` | gauge | — | Current number of pods |
| `helyos_deployments_total` | gauge | — | Current number of deployments |
| `helyos_proxy_requests_total` | counter | `domain`, `status` | Reverse-proxy requests |
| `helyos_proxy_request_duration_seconds` | histogram | `domain` | Proxy upstream request duration |
| `helyos_proxy_errors_total` | counter | `domain`, `error_type` | Reverse-proxy errors |

A scrape against a running daemon looks roughly like this:

```text
# HELP helyos_nodes_total Current number of cluster nodes
# TYPE helyos_nodes_total gauge
helyos_nodes_total 1
# HELP helyos_pods_total Current number of pods
# TYPE helyos_pods_total gauge
helyos_pods_total 3
# HELP helyos_deployments_total Current number of deployments
# TYPE helyos_deployments_total gauge
helyos_deployments_total 1
# HELP helyos_http_requests_total Total HTTP requests
# TYPE helyos_http_requests_total counter
helyos_http_requests_total{method="GET",path="/api/v1/pods",status="200"} 12
```

### Scraping with Prometheus

Point Prometheus at the daemon's `/metrics` endpoint. Add a scrape job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: helyos
    metrics_path: /metrics
    static_configs:
      - targets:
          - cluster.example.com:6443
```

If the daemon is serving HTTPS with a self-signed certificate (the default for non-loopback binds), tell Prometheus how to trust it:

```yaml
scrape_configs:
  - job_name: helyos
    scheme: https
    metrics_path: /metrics
    static_configs:
      - targets:
          - cluster.example.com:6443
    tls_config:
      # Trust the daemon's CA (fetch it from GET /api/v1/ca)
      ca_file: /etc/prometheus/helyos-ca.pem
```

You can retrieve the daemon's CA PEM (for `ca_file`) from the public `/api/v1/ca` endpoint:

```bash
curl -s https://cluster.example.com:6443/api/v1/ca | jq -r .pem > /etc/prometheus/helyos-ca.pem
```

:::tip

In a multi-node cluster, each daemon exposes its own `/metrics`. Add every node's address to the `targets` list (or use Prometheus service discovery) so you collect HTTP, scheduler, and proxy metrics from the whole cluster.

:::

## The SSE event stream

For real-time cluster activity, the daemon exposes a Server-Sent Events stream at `GET /api/v1/events`. Unlike `/metrics`, this endpoint is **protected** and requires a bearer token.

Each event is a JSON object with these fields:

| Field | Description |
|---|---|
| `timestamp` | RFC 3339 / ISO 8601 UTC timestamp |
| `kind` | Resource kind (e.g. `pod`) |
| `name` | Resource name (e.g. the container ID) |
| `action` | What happened (`started`, `died`, `OOMKilled`) |
| `message` | Human-readable description |

Consume the stream with `curl` (note the `Accept` header and bearer token):

```bash
curl -N \
  -H "Authorization: Bearer $HELYOS_API_TOKEN" \
  -H "Accept: text/event-stream" \
  https://cluster.example.com:6443/api/v1/events
```

Sample output:

```text
data: {"timestamp":"2026-06-07T12:00:01Z","kind":"pod","name":"a1b2c3d4-...","action":"started","message":"Container started"}

data: {"timestamp":"2026-06-07T12:01:14Z","kind":"pod","name":"a1b2c3d4-...","action":"OOMKilled","message":"Container killed by OOM"}
```

:::note

Container exits with code `137` are reported as `OOMKilled`; other non-zero exits are reported with action `died`. These events are driven by the daemon's container event watcher, which feeds the same signals back into the orchestrator for restart and rescheduling decisions.

:::

If a slow consumer falls behind, the stream emits a warning event instead of dropping silently:

```text
data: {"warning":"missed 5 events"}
```

## helyos top — live dashboard

`helyos top` opens an interactive terminal dashboard that combines pod state, per-node resource usage, and the live event stream in one view. It polls the API every two seconds and subscribes to `GET /api/v1/events` for real-time updates.

```bash
helyos top
```

The dashboard has three panels:

- **Pods** — pod name, status, and restarts, pulled from `GET /api/v1/pods`.
- **Nodes** — per-node CPU and memory gauges plus pod counts, from `GET /api/v1/nodes/stats`.
- **Events** — the live SSE feed from `GET /api/v1/events`.

Keyboard controls:

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Cycle the active panel (Pods → Nodes → Events) |
| `Up` / `Down` (or `k` / `j`) | Move the cursor within the active panel |
| `l` / `Enter` | View logs for the selected pod (Pods panel) |
| `s` | Scale the selected pod's deployment (Pods panel) |
| `d` | Delete the selected pod (Pods panel) |
| `?` | Toggle the help overlay |
| `q` / `Esc` | Quit |

:::tip

`helyos top` is the fastest way to watch a rollout or debug a crash loop: the Events panel surfaces `started`, `died`, and `OOMKilled` actions as they happen, while the Pods panel shows restart counts climbing.

:::

## helyos status

For a one-shot, non-interactive overview, use `helyos status`. It summarizes the cluster mode, project count, and deployment/pod health.

```bash
helyos status
```

```text
┌─ Cluster Status ──────────────────────────────┐
│ Mode         single-node                       │
│ Status       ● running                         │
│ Projects     2                                 │
│ Deployments  3 running · 0 stopped             │
│ Pods         7 running · 0 restarting          │
└────────────────────────────────────────────────┘
```

Add `--json` for scripting and CI/CD pipelines:

```bash
helyos status --json
```

```json
{
  "cluster": "single-node",
  "nodes": 1,
  "projects": 2,
  "deployments": { "total": 3, "running": 3, "stopped": 0 },
  "pods": { "total": 7, "running": 7, "restarting": 0 }
}
```

## Node stats

The `GET /api/v1/nodes/stats` endpoint returns per-node CPU, memory, and pod-count data — the same source the `top` dashboard's Nodes panel uses. In single-node mode it reports the local machine's live resource usage; in a cluster it reports every registered node.

```bash
curl -s \
  -H "Authorization: Bearer $HELYOS_API_TOKEN" \
  https://cluster.example.com:6443/api/v1/nodes/stats | jq
```

```json
[
  {
    "name": "node-1",
    "role": "master",
    "status": "ready",
    "cpu_cores": 8.0,
    "cpu_usage_percent": 12.4,
    "memory_total_bytes": 16777216000,
    "memory_used_bytes": 5368709120,
    "pod_count": 3
  }
]
```

To list nodes and their roles/status without live resource sampling, use `helyos nodes` (backed by `GET /api/v1/nodes`):

```bash
helyos nodes
```

## Next steps

- [REST API reference](/docs/reference/rest-api) — full list of endpoints, including `/metrics`, `/api/v1/events`, and `/api/v1/nodes/stats`.
- [CLI reference](/docs/reference/cli) — every `helyos` command and flag, including `top`, `status`, and `nodes`.
- [API tokens](/docs/security/api-tokens) — how to mint tokens for protected endpoints like the event stream.

## See also

- [Health checks & restart policies](/docs/concepts/health-and-restart) — how Helyos detects unhealthy pods and handles crash loops.
- [Scheduling](/docs/concepts/scheduling) — what the `helyos_schedule_duration_seconds` metric measures.
- [Routing](/docs/guides/routing) — the reverse proxy behind the `helyos_proxy_*` metrics.
