---
sidebar_position: 2
title: "Quickstart"
description: Start helyosd, deploy a tiny nginx service from YAML, then check status, scale, and clean up — in a few minutes.
---

# Quickstart

This is the fastest path from zero to a running service. You'll start the daemon (`helyosd`), deploy a one-replica nginx service from a YAML file, inspect it, scale it up, and tear it down. The whole thing takes a few minutes and runs entirely on your local machine.

:::note

This guide assumes both binaries are already installed and a container runtime (Docker or containerd) is running on the host. If you haven't installed yet, follow the [Installation](/docs/getting-started/installation) guide first.

:::

## 1. Start the daemon

`helyosd` is the orchestration engine. Start it with no flags:

```bash
helyosd
```

On first run, the daemon does three things for you:

1. **Generates an API token** and logs it once (as `HELYOS_API_TOKEN=...`). Save it if you plan to script against the API — but for local CLI use you won't need to touch it.
2. **Serves the REST API** on `127.0.0.1:6443`. Because the default bind is loopback, the API stays plain HTTP for convenience. (Bind to a non-loopback address and TLS turns on automatically — see [Remote access](/docs/guides/remote-access).)
3. **Writes a ready-to-use local CLI context** to `~/.helyos/config.toml`, so the `helyos` CLI talks to this daemon with no extra setup.

:::tip Zero-config local

That third step is the key to the quickstart: once `helyosd` is running, every `helyos` command below "just works" against the local daemon — no `helyos login`, no flags, no token to paste.

:::

If you installed via the install script, the daemon may already be running as a background service (launchd on macOS, `systemd --user` on Linux). In that case you can skip straight to the next step. Otherwise, leave `helyosd` running in this terminal and open a second one for the `helyos` commands.

Confirm the daemon is reachable:

```bash
helyos status
```

## 2. Write a deployment spec

Create a file called `nginx.yaml`. This is the smallest useful spec: a single nginx replica in a project named `demo`.

```yaml
project: demo

deployment:
  name: nginx

replicas: 1
image: nginx:alpine

ports:
  - 8080

healthcheck:
  path: /
  interval: 10s
```

A few things to note:

- **`project`** and **`deployment.name`** are the only truly required fields besides `image`. A project is just a logical boundary that groups deployments (here, `demo`).
- **`replicas`** defaults to `1`, so this line is optional — it's shown for clarity.
- **`healthcheck`** uses an HTTP probe only: `helyosd` issues a `GET` against `path` on each pod. There is no TCP or exec probe.

:::tip

Prefer to scaffold instead of writing YAML by hand? Run `helyos init demo --image nginx:alpine`, which writes a starter spec to `demo/app.yaml` that you can edit and deploy.

:::

For the full list of fields, see the [Deployment spec reference](/docs/reference/deployment-spec).

## 3. Deploy it

```bash
helyos deploy nginx.yaml
```

The CLI submits the spec, then waits for pods to become ready (up to 60 seconds by default — override with `--timeout SECS`). When the replica is `Running`, you'll see a panel confirming the deployment.

## 4. Check what's running

Three commands cover the basics. `status` gives a cluster overview, `pods` lists the running containers, and `logs` streams output from a deployment.

```bash
# Cluster overview
helyos status

# Running pods (filter to one project with -p)
helyos pods -p demo

# Stream logs from the nginx deployment
helyos logs nginx -p demo
```

:::note Default project

When you omit `-p`/`--project`, the CLI targets the project named `default`. Because the service above lives in `demo`, pass `-p demo` (or set a default project on your context). `logs` follows the stream until you press `Ctrl-C`; use `--tail N` to start from the last `N` lines.

:::

You can also list deployments directly:

```bash
helyos deployments -p demo
```

Every command supports `--json` for scripting:

```bash
helyos pods -p demo --json | jq '.[].deployment_name'
```

## 5. Scale it

Bump the deployment from one replica to three:

```bash
helyos scale nginx 3 -p demo
```

Re-run `helyos pods -p demo` and you'll see three pods. The scheduler places them across available nodes (on a single-node setup, all three land locally). To learn how placement decisions are made, see [Scaling](/docs/concepts/scaling) and [Scheduling](/docs/concepts/scheduling).

## 6. Clean up

Stop the deployment (keeps the definition, stops the pods):

```bash
helyos stop nginx -p demo
```

Or remove it entirely (`-y` skips the confirmation prompt):

```bash
helyos rm nginx -p demo -y
```

To tear down the whole project and everything in it:

```bash
helyos project delete demo -y
```

That's the full loop: start, deploy, inspect, scale, clean up.

## Next steps

- [First Deployment](/docs/getting-started/first-deployment) — a deeper walkthrough that adds environment variables, secrets, and a public route.
- [Deploy a service](/docs/guides/deploy-a-service) — the task-focused guide for everyday deployments.
- [CLI reference](/docs/reference/cli) — every command and flag.
- [Deployment spec reference](/docs/reference/deployment-spec) — all YAML fields, with examples.

## See also

- [Projects](/docs/concepts/projects) and [Deployments and pods](/docs/concepts/deployments-and-pods) — the core mental model.
- [Remote access](/docs/guides/remote-access) — drive a daemon on another machine with `helyos login`.
