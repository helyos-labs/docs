---
sidebar_position: 3
title: "Your First Deployment"
description: Scaffold an app with helyos init, edit the generated spec, deploy it, watch pods come up, view logs, scale, and expose it with a route.
---

# Your First Deployment

This walkthrough takes you from an empty directory to a running, scaled, and publicly reachable service. Along the way you will learn what each part of a Helyos deployment spec means, so by the end you can write one from scratch.

If you just want the shortest path to a running container, see the [Quickstart](/docs/getting-started/quickstart). This page is the slower, narrated version.

:::note Prerequisites

You need `helyosd` running and the `helyos` CLI installed. If you ran the [installer](/docs/getting-started/installation), the daemon is already running locally and wrote a CLI context for you, so `helyos` works against the local daemon with no extra setup. Confirm with:

```bash
helyos status
```

:::

## Step 1: Scaffold a project

A Helyos deployment is described by a single YAML file. Rather than writing one by hand, use `helyos init` to scaffold one. Run it without arguments for an interactive prompt:

```bash
helyos init
```

```text
Project name: hello
Deployment name (hello):
Container image (nginx:alpine):
```

Or scaffold non-interactively by passing a name and image:

```bash
helyos init hello --image nginx:alpine
```

Either way, `init` creates a directory named after your project containing a single `app.yaml`:

```text
✓ Created hello/app.yaml

Next steps:
  1. Edit hello/app.yaml to customize your deployment
  2. Deploy with: helyos deploy hello/app.yaml
```

:::tip

`helyos init` refuses to overwrite an existing `<name>/app.yaml`. If you want to start fresh, remove the old file or pick a different name.

:::

## Step 2: Read the generated spec

Open `hello/app.yaml`. The scaffold is deliberately minimal at the top, with every optional section included as comments so you can uncomment what you need:

```yaml
# Helyos deployment spec — hello
# Docs: https://github.com/helyos-labs/helyos

project: hello

deployment:
  name: hello

image: nginx:alpine
replicas: 1

# ports:
#   - 3000

# env:
#   DATABASE_URL: "postgres://localhost/mydb"

# network:
#   public: true
#   domain: hello.example.com
#   https: true

# healthcheck:
#   path: /health
#   interval: 10s
#   timeout: 5s
#   retries: 3

# volumes:
#   - name: data
#     mount: /app/data

# restart: always  # always | onfailure | never
```

Here is what each field does:

| Field | Meaning |
|---|---|
| `project` | The [project](/docs/concepts/projects) this deployment belongs to. Projects group related deployments and act as an isolation boundary. **Required.** |
| `deployment.name` | The name of this deployment. **Required.** |
| `image` | The container image to run, e.g. `nginx:alpine` or `ghcr.io/you/api:latest`. **Required.** |
| `replicas` | How many identical [pods](/docs/concepts/deployments-and-pods) to run. Defaults to `1`. |
| `ports` | Container ports to expose, as a list of integers. |
| `env` | Environment variables, as a map of `KEY: "value"`. |
| `network` | Whether the deployment is reachable from outside the cluster, and on what domain. |
| `healthcheck` | An HTTP probe Helyos uses to decide whether a pod is healthy. |
| `volumes` | Persistent storage to mount into the container. |
| `restart` | What to do when a container exits: `always`, `onfailure`, or `never`. Defaults to `always`. |

:::info A deployment becomes pods

A **deployment** is the desired state ("run 3 copies of this image"). Helyos turns that into running **pods** — one per replica. You scale a deployment by changing how many pods it manages. See [Deployments and Pods](/docs/concepts/deployments-and-pods).

:::

## Step 3: Edit the spec

Let's make the deployment a little more realistic: pull a versioned web image, run two replicas, expose a port, and add a health check. Replace the contents of `hello/app.yaml` with:

```yaml
project: hello

deployment:
  name: web

image: nginx:1.27-alpine
replicas: 2

ports:
  - 80

healthcheck:
  path: /
  interval: 10s
  timeout: 5s
  retries: 3

restart: always
```

A few things worth noting:

- **`replicas: 2`** means Helyos will start two pods for this deployment and keep both running.
- **`ports`** is a list of integers — the ports your container listens on inside its network.
- The **`healthcheck`** is an HTTP GET against `path` (here `/`). Helyos probes it every `interval`, allowing `timeout` per attempt and `retries` consecutive failures before marking a pod unhealthy. HTTP is the only probe type — there is no TCP or exec probe.

:::warning Use the exact field names

Two field names trip people up:

- The restart policy value for "restart only on a non-zero exit" is **`onfailure`** (one word), not `on-failure` or `OnFailure`.
- A volume's container path key is **`mount`**, not `mount_path`.

The full field reference lives in the [Deployment Spec](/docs/reference/deployment-spec).

:::

## Step 4: Deploy

Apply the spec with `helyos deploy`, pointing at the file:

```bash
helyos deploy hello/app.yaml
```

The CLI submits the spec, then watches the pods come up and reports progress live:

```text
✓ Image    nginx:1.27-alpine pulled
✓ Pod      helyos-hello-web-0 running
✓ Pod      helyos-hello-web-1 running

  web   ● Deployed   2/2 pods ready · 3.4s
```

Helyos pulls the image, schedules each replica onto a node, starts the containers, and waits for them to reach the `Running` state. The command returns once all replicas are ready.

:::tip Deploy is idempotent

`helyos deploy` describes desired state. Re-running it after editing the spec reconciles the running deployment toward the new spec — change `replicas`, the `image`, or any other field and deploy again.

If a deploy is slow (for example, a large image pull), raise the wait window with `--timeout`:

```bash
helyos deploy hello/app.yaml --timeout 300
```

:::

## Step 5: Watch the pods come up

List the pods Helyos created for your deployment:

```bash
helyos pods
```

```text
 Pods                                                              2 total

 Name                  Project  Deployment  Status   Image               Age
 helyos-hello-web-0    hello    web         Running  nginx:1.27-alpine   12s
 helyos-hello-web-1    hello    web         Running  nginx:1.27-alpine   12s
```

Each pod's name follows the pattern `helyos-<project>-<deployment>-<index>`. A pod moves through `Pending` → `Creating` → `Running` as it starts. If a container keeps crashing, you will see `Restarting` and eventually `CrashLoopBackoff` — Helyos backs off exponentially between restart attempts. For a deeper look at the lifecycle, see [Health and Restart](/docs/concepts/health-and-restart).

For a compact summary of the whole cluster, use `helyos status`, or `helyos top` for a live, continuously updating dashboard:

```bash
helyos status
helyos top
```

## Step 6: View logs

Stream a deployment's container logs by deployment name. Because this deployment lives in the `hello` project (not the default project), pass `-p`:

```bash
helyos logs web -p hello
```

```text
14:02:11 web │ 172.20.0.1 - - [07/Jun/2026:14:02:11 +0000] "GET / HTTP/1.1" 200 615
14:02:13 web │ 172.20.0.1 - - [07/Jun/2026:14:02:13 +0000] "GET / HTTP/1.1" 200 615
```

Logs stream live — press `Ctrl-C` to stop. To start from the last N lines instead of only new output, use `--tail`:

```bash
helyos logs web -p hello --tail 100
```

:::note The default project

If you omit `-p` / `--project`, the CLI targets the project named `default`. Since this walkthrough deployed into the `hello` project, you must pass `-p hello` to `logs`, `scale`, `stop`, and similar commands.

:::

## Step 7: Scale

Scaling is a single command — give it the deployment name and the desired replica count:

```bash
helyos scale web 4 -p hello
```

```text
✓ Scaled 'web' to 4 replicas
```

Helyos starts the additional pods and the scheduler spreads them across available nodes. List the pods again to see the new replicas:

```bash
helyos pods -p hello
```

Scaling down works the same way — `helyos scale web 1 -p hello` removes the extra pods. You can also bake the replica count into `app.yaml` and re-deploy; both approaches converge to the same state. For how scaling and the scheduler interact, see [Scaling](/docs/concepts/scaling) and [Scheduling](/docs/concepts/scheduling).

## Step 8: Expose it with a route

So far your service is reachable only inside the cluster. To serve it on a public domain, add a route mapping a hostname to the deployment. Helyos's built-in reverse proxy handles host-based routing:

```bash
helyos route add hello.example.com -p hello --deployment web --https
```

Add `--https` and Helyos automatically obtains and renews a TLS certificate via ACME (Let's Encrypt) for that domain — provided the daemon was started with an ACME contact email (`--acme-email`) and the domain resolves to your cluster.

List your routes to confirm:

```bash
helyos routes -p hello
```

The scaffold includes a commented `network` section in `app.yaml` that documents the intended public-domain fields:

```yaml
network:
  public: true
  domain: hello.example.com
  https: true
```

This block is accepted by the spec parser, but creating the route today is done with `helyos route add` — that command is what actually wires the domain to the deployment and (with `--https`) requests a certificate.

Routing has more options — choosing a proxy backend, importing your own certificate, wildcard behavior — covered in the [Routing guide](/docs/guides/routing) and [TLS guide](/docs/guides/tls).

## Step 9: Clean up

When you are done experimenting, stop or remove the deployment:

```bash
# Stop the pods but keep the deployment definition
helyos stop web -p hello

# Remove the deployment entirely (prompts for confirmation)
helyos rm web -p hello
```

To tear down everything in one go, delete the whole project:

```bash
helyos project delete hello
```

## What you learned

You scaffolded a project, edited a real deployment spec, deployed it, watched pods reach `Running`, streamed logs, scaled up, and exposed the service on a domain — the full inner loop of working with Helyos.

## Next steps

- [Deployments and Pods](/docs/concepts/deployments-and-pods) — how desired state becomes running containers
- [Deployment Spec reference](/docs/reference/deployment-spec) — every field, with defaults
- [CLI reference](/docs/reference/cli) — every command and flag
- [Secrets](/docs/guides/secrets) — inject credentials without baking them into the image
- [Routing](/docs/guides/routing) and [TLS](/docs/guides/tls) — expose services on the public internet
- [Clustering](/docs/guides/clustering) — add worker nodes and run across machines
