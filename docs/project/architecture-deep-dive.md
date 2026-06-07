---
sidebar_position: 1
title: "Architecture Deep Dive"
description: A contributor-focused tour of Helyos' hexagonal architecture — the actor-model orchestrator, the eight port traits, their helyosd adapters, and the core/daemon/cli crate split.
---

# Architecture Deep Dive

This page is for contributors. It explains how Helyos is put together internally: the hexagonal (ports and adapters) design, the actor-model orchestrator at the center, the eight port traits that abstract every external concern, the concrete adapters that implement them in `helyosd`, and how the codebase is split across three crates.

If you just want to deploy and operate Helyos, start with the [user-facing architecture overview](/docs/introduction/architecture) instead. This page assumes you have read the source and want to change it.

## The big picture: hexagonal architecture

Helyos follows **hexagonal architecture**, also known as ports and adapters. The idea is simple: the domain logic depends only on abstract interfaces (ports), never on concrete I/O. Everything that touches the outside world — Docker, SQLite, the network, DNS, the reverse proxy — sits behind a trait. The orchestrator and domain code in `helyos-core` import those traits and nothing else.

This gives you three concrete benefits as a contributor:

- **Testability.** `helyos-core` ships in-memory adapters (`state_memory.rs`, `secrets_memory.rs`, `route_store_memory.rs`) so the full orchestrator can be exercised in unit tests with no Docker, no database, and no network. The library has 180 unit tests that run this way.
- **Swappable backends.** Because the orchestrator only knows the `ProxyBackend` trait, you can run Traefik, nginx, or Caddy without touching domain code. The same is true for the container runtime (Docker or containerd) and the DNS provider.
- **A clean dependency direction.** Dependencies always point inward — adapters depend on ports, ports live with the domain, and the domain depends on nothing external. You never have to reason about Docker semantics while reading scheduler logic.

```text
        ┌──────────────────────── helyosd (adapters) ────────────────────────┐
        │  DockerRuntime   SqliteStore   EncryptedSqliteSecretStore   ...     │
        └───────▲────────────▲────────────────▲──────────────────────────────┘
                │ implements  │ implements     │ implements
        ┌───────┴────────────┴────────────────┴──────────────────────────────┐
        │  ports/  ContainerRuntime  StateStore  SecretStore  ...  (traits)   │
        │                                                                      │
        │  domain/  Orchestrator (actor loop)  Scheduler  Health  Restart      │  helyos-core
        └──────────────────────────────────────────────────────────────────────┘
```

:::note

The domain never names a concrete adapter. The `Orchestrator` holds `Arc<dyn ContainerRuntime>`, `Option<Arc<dyn StateStore>>`, and so on — trait objects. Wiring concrete types together happens exactly once, in `helyosd`'s `main.rs`, and nowhere else.

:::

## The crate split

Helyos is three crates across three repositories. The split mirrors the architecture: the inside of the hexagon is one crate, the adapters are another, and the user-facing client is the third.

| Crate | Repository | What lives here |
|---|---|---|
| `helyos-core` | [`helyos-core`](https://github.com/helyos-labs/helyos-core) | Domain models, the eight port traits, the orchestrator, scheduler, health and restart logic, YAML spec parsing, and in-memory test adapters. Library only — no binary. |
| `helyosd` | [`helyosd`](https://github.com/helyos-labs/helyosd) | The daemon binary. All concrete adapters, the REST API, clustering over gRPC, TLS, token storage, and the `main.rs` that wires everything together. |
| `helyos-cli` | [`helyos-cli`](https://github.com/helyos-labs/helyos-cli) | The `helyos` CLI binary. A thin HTTP client over the daemon's REST API plus context/config management. It pins `helyos-core` to reuse the domain model types and the YAML spec parser, but never touches the port traits or the orchestrator. |

`helyosd` and `helyos-cli` both pin `helyos-core` as a Git dependency. The current versions are `helyos-core` 0.1.7, `helyosd` 0.3.2, and `helyos-cli` 0.3.0. All three use Rust edition 2024; the MSRV is 1.85, except `helyosd`, which needs 1.88.

See the [repositories map](/docs/project/repositories) for how the repos depend on one another and where to find each piece.

### Why the CLI is not in the hexagon

The CLI talks to the daemon purely over the [REST API](/docs/reference/rest-api) — it never imports the port traits and never calls the orchestrator. It does pin `helyos-core` to reuse the domain model structs (so it can deserialize API responses into typed values) and the YAML spec parser, but that is a serialization convenience, not a domain dependency. This keeps the wire contract honest: anything the CLI can do, any HTTP client can do. If you are adding a feature, the rule of thumb is that it lands in `helyos-core` (domain), gets an adapter and an HTTP route in `helyosd`, and then gets a command in `helyos-cli`.

## The actor-model orchestrator

The heart of `helyos-core` is the **orchestrator**, an actor that owns all mutable cluster state and processes one command at a time. It lives in `src/domain/orchestrator.rs`. Instead of guarding shared state with locks, the orchestrator owns the state outright and serializes access through a channel. This makes the reconciliation logic single-threaded and easy to reason about: there is no interleaving, no lock ordering, and no data races on the in-memory caches.

### The command channel

`Orchestrator::spawn` creates a bounded Tokio `mpsc` channel (capacity 256), moves the orchestrator struct into a `tokio::spawn`ed task, and returns an `OrchestratorHandle`. The task runs a loop that receives `Command` values and matches on them. Every caller — the REST API handlers, the health checker, the container event watcher — holds a clone of the handle and sends commands through it.

```rust
pub struct Orchestrator {
    runtime: Arc<dyn ContainerRuntime>,
    state_store: Option<Arc<dyn StateStore>>,
    secret_store: Option<Arc<dyn SecretStore>>,
    transport: Option<Arc<dyn ClusterTransport>>,
    scheduler: WeightedScheduler,
    health_tracker: HealthTracker,
    // in-memory caches: projects, deployments, pods, restart_states ...
    dns: Option<Arc<dyn DnsProvider>>,
    proxy: Option<Arc<dyn ProxyBackend>>,
    route_store: Option<Arc<dyn RouteStore>>,
    metrics: Option<Arc<dyn MetricsPort>>,
    tx: mpsc::Sender<Command>,
}
```

Note that the orchestrator holds its own `tx`. That is how it schedules deferred work for itself — for example, when a restart backoff elapses it sends itself a `Command::RestartPod` rather than recursing.

### The Command enum

Each request is a `Command` variant. Variants that return a value carry a `oneshot::Sender` named `reply`; the handle awaits the matching `oneshot::Receiver`. Fire-and-forget variants (health reports, container-exit notifications, restart triggers) carry no reply. There are 24 variants in total:

```rust
pub enum Command {
    Deploy { spec: DeploymentSpec, reply: oneshot::Sender<Result<Deployment>> },
    ListDeployments { project: Option<String>, reply: oneshot::Sender<Vec<Deployment>> },
    ListPods { project: Option<String>, reply: oneshot::Sender<Vec<Pod>> },
    CreateProject { name: String, reply: oneshot::Sender<Result<Project>> },
    ListProjects { reply: oneshot::Sender<Vec<Project>> },
    Stop { project: String, name: String, reply: oneshot::Sender<Result<()>> },
    RemoveDeployment { project: String, name: String, reply: oneshot::Sender<Result<()>> },
    Scale { project: String, name: String, replicas: u32, reply: oneshot::Sender<Result<Deployment>> },
    PodLogs { project: String, name: String, tail: Option<u64>, reply: oneshot::Sender<Result<LogStream>> },
    HealthReport { pod_id: Uuid, healthy: bool },
    GetHealthProbeTargets { reply: oneshot::Sender<Vec<(Uuid, PodHealthConfig)>> },
    ContainerExited { pod_id: Uuid, exit_code: i64 },
    RestartPod { pod_id: Uuid },
    SuspendProject { name: String, reply: oneshot::Sender<Result<()>> },
    ResumeProject { name: String, reply: oneshot::Sender<Result<()>> },
    DeleteProject { name: String, reply: oneshot::Sender<Result<()>> },
    ListSecrets { project: String, reply: oneshot::Sender<Result<Vec<String>>> },
    SetSecret { project: String, name: String, value: Vec<u8>, reply: oneshot::Sender<Result<()>> },
    DeleteSecret { project: String, name: String, reply: oneshot::Sender<Result<()>> },
    GetSchedulerConfig { reply: oneshot::Sender<SchedulerConfig> },
    SetSchedulerConfig { config: SchedulerConfig, reply: oneshot::Sender<Result<SchedulerConfig>> },
    AddRoute { domain: String, project: String, deployment: String, tls_mode: String, reply: oneshot::Sender<Result<()>> },
    RemoveRoute { domain: String, reply: oneshot::Sender<Result<()>> },
    ListRoutes { project: Option<String>, reply: oneshot::Sender<Vec<Route>> },
}
```

### The handle

`OrchestratorHandle` is a cheap, `Clone`able wrapper around the `mpsc::Sender`. It exposes one async method per command and hides the channel mechanics. A typical method builds a `oneshot` pair, sends the command, and awaits the reply:

```rust
impl OrchestratorHandle {
    pub async fn deploy(&self, spec: DeploymentSpec) -> Result<Deployment> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Command::Deploy { spec, reply })
            .await
            .map_err(|_| HelyosError::Runtime("orchestrator stopped".into()))?;
        rx.await
            .map_err(|_| HelyosError::Runtime("orchestrator dropped reply".into()))?
    }
}
```

Fire-and-forget methods such as `report_health` and `send_container_exited` just send the command and ignore the result. The handle also exposes `command_sender()`, which clones the raw `mpsc::Sender` so background tasks (like the event watcher) can push commands without going through a typed method.

:::tip

When you add a feature that mutates cluster state, add a `Command` variant and a corresponding `OrchestratorHandle` method, then handle it in the `match` inside `run`. Do not reach into the orchestrator's caches from outside — everything funnels through the channel so that the single-writer invariant holds.

:::

### Startup reconciliation

When the task starts, `run` first calls `load_state` (rehydrating projects, deployments, and pods from the `StateStore` if one is configured) and then `reconcile_stale_pods` before entering the receive loop. This is how the daemon recovers after a restart: it loads what it persisted, then reconciles reality against desired state.

## The port traits

All eight ports live in `helyos-core/src/ports/`. Each is an object-safe trait (most are `#[async_trait]`). The orchestrator holds them as trait objects, and every one except `ContainerRuntime` is optional — the orchestrator can run with just a runtime, which is exactly what the in-memory test setup does.

### ContainerRuntime — 14 methods

The runtime port (`ports/runtime.rs`) abstracts the container engine. It is the only required port. Alongside the trait, the module defines the runtime-facing value types: `ContainerConfig`, `PortBinding`, `VolumeBinding`, `ContainerInfo`, `ContainerState`, and the `RuntimeEvent` stream item.

```rust
#[async_trait]
pub trait ContainerRuntime: Send + Sync {
    fn runtime_name(&self) -> &'static str;
    async fn pull_image(&self, image: &str) -> Result<()>;
    async fn create_container(&self, config: &ContainerConfig) -> Result<String>;
    async fn start_container(&self, id: &str) -> Result<()>;
    async fn stop_container(&self, id: &str, timeout_secs: u64) -> Result<()>;
    async fn remove_container(&self, id: &str, force: bool) -> Result<()>;
    async fn inspect_container(&self, id: &str) -> Result<ContainerInfo>;
    async fn logs(&self, id: &str, tail: Option<u64>) -> Result<LogStream>;
    async fn container_exists(&self, name: &str) -> Result<bool>;
    async fn create_network(&self, name: &str) -> Result<String>;
    async fn remove_network(&self, name: &str) -> Result<()>;
    async fn connect_to_network(&self, container_id: &str, network: &str) -> Result<()>;
    async fn container_ip(&self, container_id: &str, network: &str) -> Result<String>;
    async fn events(&self) -> Result<EventStream>;
}
```

The `events` method returns a stream of `RuntimeEvent` (`ContainerDied { container_id, exit_code }`, `ContainerStarted { container_id }`, `ContainerOom { container_id }`). In `helyosd` the event watcher consumes this stream and forwards `Command::ContainerExited` into the orchestrator, which is what drives restart and crash-loop detection.

### StateStore — 23 methods

The state port (`ports/state.rs`) persists projects, deployments, pods, nodes, and a key-value cluster-config table. It is the orchestrator's durable backing store; everything the orchestrator caches in memory can be reconstructed from it.

```rust
#[async_trait]
pub trait StateStore: Send + Sync {
    async fn insert_project(&self, project: &Project) -> Result<()>;
    async fn get_project(&self, name: &str) -> Result<Option<Project>>;
    async fn list_projects(&self) -> Result<Vec<Project>>;
    async fn update_project_status(&self, name: &str, status: ProjectStatus) -> Result<()>;
    async fn delete_project(&self, name: &str) -> Result<()>;
    // deployments: insert / get / list / update / delete
    // pods:        insert / list / update / delete / pods_by_deployment
    // nodes:       insert / get / get_by_name / list / update / delete
    // cluster config: get_cluster_config / set_cluster_config
}
```

The module also exports `STATE_SCHEMA_VERSION` (currently `1`). Bump it when the persisted representation changes incompatibly so adapters can detect and migrate stale data.

### SecretStore

The secret port (`ports/secrets.rs`) is deliberately tiny — four methods scoped by project:

```rust
#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn set(&self, project: &str, name: &str, value: &[u8]) -> Result<()>;
    async fn get(&self, project: &str, name: &str) -> Result<Option<Vec<u8>>>;
    async fn list(&self, project: &str) -> Result<Vec<String>>;
    async fn delete(&self, project: &str, name: &str) -> Result<()>;
}
```

Values are `&[u8]`, not strings — the port has no opinion about encryption. That concern lives entirely in the adapter. See [secrets encryption](/docs/security/secrets-encryption) for how the encrypted adapter handles it.

### ClusterTransport

The cluster port (`ports/cluster.rs`) is how a master talks to its workers. The orchestrator uses it to register nodes, receive heartbeats, and push pod assignments out to remote nodes.

```rust
#[async_trait]
pub trait ClusterTransport: Send + Sync {
    async fn register_node(&self, node: &Node) -> Result<()>;
    async fn heartbeat(&self, node_id: &Uuid, status: &NodeStatus, resources: &NodeResources) -> Result<()>;
    async fn assign_pod(&self, node_id: &Uuid, pod: &Pod, spec: &DeploymentSpec) -> Result<()>;
    async fn stop_pod(&self, node_id: &Uuid, pod_id: &Uuid) -> Result<()>;
    async fn remove_pod(&self, node_id: &Uuid, pod_id: &Uuid) -> Result<()>;
    async fn stream_logs(&self, node_id: &Uuid, pod_id: &Uuid, tail: Option<u64>) -> Result<LogStream>;
}
```

### DnsProvider

The DNS port (`ports/dns.rs`) backs service discovery. When a pod gets an IP the orchestrator registers it; when the pod goes away it deregisters.

```rust
#[async_trait]
pub trait DnsProvider: Send + Sync {
    async fn register(&self, project: &str, deployment: &str, ip: IpAddr) -> Result<()>;
    async fn deregister(&self, project: &str, deployment: &str, ip: IpAddr) -> Result<()>;
    async fn lookup(&self, project: &str, deployment: &str) -> Result<Vec<IpAddr>>;
}
```

This is what resolves `<deployment>.<project>.internal` names — see [service discovery](/docs/concepts/service-discovery).

### RouteStore

The route-store port (`ports/route_store.rs`) persists reverse-proxy routes, TLS certificates, and overlay subnet allocations. Routes and certificates are addressed by domain; subnets are addressed by `(node_id, project)`.

```rust
#[async_trait]
pub trait RouteStore: Send + Sync {
    async fn insert_route(&self, route: &Route) -> Result<()>;
    async fn get_route(&self, domain: &str) -> Result<Option<Route>>;
    async fn list_routes(&self, project: Option<&str>) -> Result<Vec<Route>>;
    async fn delete_route(&self, domain: &str) -> Result<bool>;

    async fn upsert_certificate(&self, cert: &Certificate) -> Result<()>;
    async fn get_certificate(&self, domain: &str) -> Result<Option<Certificate>>;
    async fn list_expiring_certificates(&self, within_days: i64) -> Result<Vec<Certificate>>;
    async fn delete_certificate(&self, domain: &str) -> Result<bool>;

    async fn allocate_subnet(&self, alloc: &SubnetAllocation) -> Result<()>;
    async fn get_node_subnet(&self, node_id: &str, project: &str) -> Result<Option<SubnetAllocation>>;
    async fn list_subnets(&self) -> Result<Vec<SubnetAllocation>>;
    async fn deallocate_subnet(&self, node_id: &str, project: &str) -> Result<bool>;
}
```

`list_expiring_certificates` is what the daily ACME renewal job queries to find certs that need refreshing.

### ProxyBackend

The proxy port (`ports/proxy.rs`) drives the reverse proxy. The orchestrator translates routes into `RouteConfig` values and calls `apply_routes`. The module defines the backend-facing types `RouteConfig`, `Upstream`, and `TlsConfig` (with `None`, `Auto { email }`, and `Manual { cert, key }` variants).

```rust
#[async_trait]
pub trait ProxyBackend: Send + Sync {
    async fn apply_routes(&self, routes: &[RouteConfig]) -> Result<()>;
    async fn remove_route(&self, domain: &str) -> Result<()>;
    async fn reload(&self) -> Result<()>;
    async fn health(&self) -> Result<bool>;
}
```

### MetricsPort

The metrics port (`ports/metrics.rs`) is the one non-async trait — its methods are synchronous recorders. It is how the domain emits Prometheus-style telemetry without depending on a metrics library. The module also ships `NoOpMetrics`, which the orchestrator uses when no metrics adapter is configured.

```rust
pub trait MetricsPort: Send + Sync {
    fn record_http_request(&self, method: &str, path: &str, status: u16, duration_secs: f64);
    fn record_container_event(&self, event: &str);
    fn record_schedule_decision(&self, strategy: &str, duration_secs: f64);
    fn record_deployment_op(&self, op: &str);
    fn set_node_count(&self, count: usize);
    fn set_pod_count(&self, count: usize);
    fn set_deployment_count(&self, count: usize);
    fn record_proxy_request(&self, domain: &str, status: u16, duration_secs: f64);
    fn record_proxy_error(&self, domain: &str, error_type: &str);
    fn record_persistence_error(&self, _op: &str) {}
    fn as_any(&self) -> &dyn Any;
}
```

:::note

`record_persistence_error` has a default no-op body on purpose. Because `helyosd` pins `helyos-core` by Git tag, defaulting new trait methods keeps out-of-tree adapters source-compatible without a coordinated bump. Follow the same pattern when you add a method to `MetricsPort`.

:::

## The helyosd adapters

Every port has at least one concrete adapter in `helyosd/src/adapters/`. This is where the messy real-world I/O lives. The table below maps each port to its production adapter(s).

| Port | helyosd adapter(s) | Backing technology |
|---|---|---|
| `ContainerRuntime` | `DockerRuntime`, `ContainerdRuntime` | Docker via the `bollard` client; containerd via the `ctr` CLI. A `RuntimeDetector` resolves `auto`. |
| `StateStore` | `SqliteStore` | SQLite via `sqlx`, with schema migrations. |
| `SecretStore` | `EncryptedSqliteSecretStore` | AES-256-GCM at rest (`aes-gcm`), stored in SQLite via `rusqlite`. |
| `ClusterTransport` | `GrpcTransport` (and `LocalTransport` for single-node) | gRPC via `tonic` + `prost`, server-authenticated TLS. |
| `DnsProvider` | `HickoryDnsProvider`, `NoopDnsProvider` | Embedded Hickory DNS server, or a no-op. |
| `RouteStore` | `SqliteRouteStore` (and `InMemoryRouteStore`) | SQLite. |
| `ProxyBackend` | `TraefikBackend`, `NginxBackend`, `CaddyBackend` | Traefik (default), nginx, or Caddy. |
| `MetricsPort` | `PrometheusMetrics` | Prometheus exposition on `/metrics`. |

A few details worth knowing if you work in these adapters:

- **Runtime selection.** `RuntimeDetector::resolve` maps the `--runtime auto|docker|containerd` flag to a `RuntimeKind`, falling back to Docker if detection is inconclusive, then `RuntimeDetector::build` constructs the adapter. The `containerd` adapter shells out to the `ctr` CLI rather than linking a client library.
- **Secrets.** The encrypted secret store derives an `Aes256Gcm` cipher from a per-node master key (auto-generated on first run) and stores a fresh random nonce alongside each ciphertext. Plaintext is never written to disk. See [secrets encryption](/docs/security/secrets-encryption).
- **Cluster TLS.** `GrpcTransport` uses server-authenticated TLS — the master serves a self-signed cert from a CA it generates, and workers verify it. Workers authenticate to the master with a join token, not a client certificate. See [clustering](/docs/guides/clustering).
- **Proxy backend selection.** The `--proxy-backend` flag (default `traefik`) picks the adapter at startup. All three implement the same `ProxyBackend` trait, so the orchestrator code is identical regardless of which proxy you run. See [routing](/docs/guides/routing).
- **DNS.** `--dns-mode embedded` wires in `HickoryDnsProvider`; the default `noop` wires in `NoopDnsProvider`, so service discovery is opt-in.

### Where the wiring happens

All of these adapters are constructed and handed to the orchestrator in exactly one place: `helyosd/src/main.rs`. The single call to `Orchestrator::spawn` is the seam between the daemon and the library:

```rust
let handle = Orchestrator::spawn(
    Arc::clone(runtime), // Arc<dyn ContainerRuntime>      (required)
    Some(Arc::clone(store)), // Option<Arc<dyn StateStore>>
    Some(secret_store),  // Option<Arc<dyn SecretStore>>
    Some(transport),     // Option<Arc<dyn ClusterTransport>>
    dns,                 // Option<Arc<dyn DnsProvider>>
    master_ip,           // Option<String>
    proxy,               // Option<Arc<dyn ProxyBackend>>
    route_store,         // Option<Arc<dyn RouteStore>>
    metrics.clone(),     // Option<Arc<dyn MetricsPort>>
);
```

After spawning, `main.rs` also starts the background tasks that feed the orchestrator: the HTTP health checker (which polls probe targets returned by `Command::GetHealthProbeTargets`) and the container event watcher (which forwards runtime events as `Command::ContainerExited`). Both hold clones of the handle.

## Putting it together: the path of a deploy

To see how the pieces interact, follow a `helyos deploy app.yaml`:

1. **CLI.** `helyos` parses the YAML, then POSTs it to `POST /api/v1/deploy` over the [REST API](/docs/reference/rest-api). The CLI knows nothing about the domain.
2. **REST handler.** The `helyosd` route handler deserializes the body into a `DeploymentSpec` (defined in `helyos-core`) and calls `handle.deploy(spec)`.
3. **Channel.** The handle sends `Command::Deploy { spec, reply }` down the `mpsc` channel and awaits the `oneshot` reply.
4. **Orchestrator.** The actor receives the command, runs the scheduler to place pods, persists state through the `StateStore` port, pulls images and creates containers through the `ContainerRuntime` port, registers DNS through the `DnsProvider` port, and replies with the `Deployment`.
5. **Adapters.** Each of those port calls dispatches to a concrete adapter — `SqliteStore`, `DockerRuntime`, `HickoryDnsProvider` — which do the actual I/O.
6. **Reply.** The `Deployment` travels back up the `oneshot`, the REST handler serializes it to JSON, and the CLI prints the result.

Every arrow between layers crosses a trait boundary. That is the whole point of the design.

## Contributing changes

When you make a change, it usually touches the layers in this order:

- **Domain or model change?** It belongs in `helyos-core`. Add or modify the model, then add a `Command` variant and an `OrchestratorHandle` method if it mutates state. Add unit tests using the in-memory adapters.
- **New external dependency (a new storage engine, a new proxy)?** Add a port if one does not exist, then implement it as an adapter in `helyosd`. Wire it in `main.rs`.
- **New user-facing operation?** Add the REST route in `helyosd` and a command in `helyos-cli`.

Run `cargo fmt` before pushing — CI enforces `cargo fmt --check`. See [contributing](/docs/project/contributing) for the full workflow.

## See also

- [Architecture overview](/docs/introduction/architecture) — the user-facing version of this page
- [Repositories](/docs/project/repositories) — the three crates and how they depend on one another
- [Contributing](/docs/project/contributing) — workflow, formatting, and conventions
- [REST API reference](/docs/reference/rest-api) — the contract between the CLI and the daemon
- [Scheduling](/docs/concepts/scheduling) and [Service discovery](/docs/concepts/service-discovery) — the domain logic the orchestrator runs
