---
sidebar_position: 1
title: "Projects"
description: A project is Helyos's logical isolation boundary that groups your deployments, secrets, network, and DNS namespace.
---

# Projects

A **project** is the top-level organizational unit in Helyos. It is a logical isolation boundary — a namespace — that groups everything belonging to a single application or environment: its deployments, secrets, per-project network, and internal DNS names.

Every deployment belongs to exactly one project. The `project` field is required in every deployment spec, and most CLI commands accept a `-p`/`--project` flag (or inherit a default project from your active context) to scope their actions.

## What a project gives you

A project ties together several resources under one name:

- **Deployments** — each deployment declares which project it belongs to. A project can hold many deployments.
- **Secrets** — secrets are stored per project and injected into that project's containers as environment variables. A secret named `db-password` in project `web` is separate from one in project `api`.
- **Network** — Helyos creates a dedicated container network per project, named `helyos-<project>`. Containers in the same project share this network.
- **DNS namespace** — with the embedded DNS resolver enabled, services resolve as `<deployment>.<project>.internal`, so the project forms the second-level part of every internal name.

:::info
A project is a logical grouping, not a security sandbox between tenants. Use it to organize and isolate workloads (for example, `web`, `api`, `staging`), not as a hard multi-tenancy boundary.
:::

## Project lifecycle and status

A project has exactly two states:

| Status | Meaning |
| --- | --- |
| `active` | The default. Deployments run normally; you can deploy, scale, and update. |
| `suspended` | All of the project's pods are stopped. New deployments to the project are rejected. |

A newly created project is always `active`.

### Creating a project

You can create a project explicitly:

```bash
helyos project create web
```

You usually don't need to, though. When you deploy a spec whose `project` does not yet exist, Helyos creates the project automatically (as `active`) before scheduling the deployment.

```yaml
# app.yaml — deploying this creates the "web" project if it's missing
project: web
deployment:
  name: frontend
image: nginx:1.27
replicas: 2
```

```bash
helyos deploy app.yaml
```

:::note
Creating a project that already exists is rejected (the API returns `409 Conflict`). You rarely need to create projects by hand, because deploys auto-create the project, so explicit `project create` is mainly useful when you want to set up secrets or routes before deploying.
:::

### Listing projects

```bash
helyos project list
```

The default table shows each project's name and age. Add `--json` for machine-readable output:

```bash
helyos project list --json
```

The JSON output reports each project's `name`, `status`, and `created_at` timestamp.

### Suspending a project

Suspending a project stops every pod in every deployment it owns, but keeps the project and its deployment definitions, secrets, and routes intact.

```bash
helyos project suspend web
```

When you suspend a project, Helyos:

- Sets the project status to `suspended`.
- Stops and removes the containers for all pods in the project.
- Deregisters those pods from internal DNS.
- Marks each affected deployment as `stopped`.
- **Rejects any new deploys** to the project until it is resumed.

Suspend is useful for pausing a staging environment overnight, freeing resources during maintenance, or temporarily taking an app offline without losing its configuration.

:::tip
Suspending is non-destructive. Your deployment specs, replica counts, secrets, and routes are preserved — resuming brings everything back exactly as it was.
:::

### Resuming a project

Resuming flips the project back to `active` and reconciles every deployment it owns, recreating pods to match each deployment's declared replica count.

```bash
helyos project resume web
```

After resume, the orchestrator schedules pods, re-registers internal DNS names, and brings deployments back to their desired state.

### Deleting a project

Deleting removes the project from Helyos entirely.

```bash
helyos project delete web
```

The CLI asks for confirmation first. Skip the prompt with `-y`/`--yes`:

```bash
helyos project delete web -y
```

:::warning
**A project must be empty before it can be deleted.** If any deployments still belong to the project, the request is rejected (the API returns `409 Conflict`). Remove the deployments first, then delete the project.
:::

Tear down a project's deployments before deleting it:

```bash
# Remove each deployment in the project
helyos rm frontend -p web -y
helyos rm api -p web -y

# Now the project can be deleted
helyos project delete web -y
```

## Working within a project

Most resource commands are scoped to a project. Pass `-p`/`--project`, or set a default project on your active context so you can omit it.

```bash
# Explicit project on each command
helyos deployments -p web
helyos pods -p web
helyos logs frontend -p web --tail 100
helyos scale frontend 3 -p web
helyos secret set db-password --value s3cr3t -p web
helyos secret list -p web
```

To avoid repeating `-p web`, point your context at a default project:

```bash
helyos context set web --project web
helyos context use web

# Now project is implied
helyos deployments
helyos pods
```

:::tip
Project resolution follows the standard Helyos precedence: an explicit `-p` flag wins, otherwise the default project from your active context is used. See [CLI configuration](/docs/reference/cli-config) for how contexts store the default project.
:::

## How a project maps to other concepts

- **Deployments and pods** — a project contains deployments; each deployment runs N pods. See [Deployments and Pods](/docs/concepts/deployments-and-pods).
- **Secrets** — secrets live inside a project and are injected as environment variables into that project's containers. See the [Secrets guide](/docs/guides/secrets).
- **Service discovery** — the embedded DNS resolver serves names of the form `<deployment>.<project>.internal`. See [Service Discovery](/docs/concepts/service-discovery).
- **Networking** — Helyos provisions a per-project container network (`helyos-<project>`). See the [Networking guide](/docs/guides/networking).

## Next steps

- [Deployments and Pods](/docs/concepts/deployments-and-pods) — what runs inside a project.
- [Deploy a service](/docs/guides/deploy-a-service) — a hands-on walkthrough.
- [Deployment spec reference](/docs/reference/deployment-spec) — the full YAML schema, including the required `project` field.
- [CLI reference](/docs/reference/cli) — every `helyos project` command and flag.
