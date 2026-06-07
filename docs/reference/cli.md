---
sidebar_position: 1
title: "CLI Reference"
description: Complete reference for the helyos command-line interface — every command, subcommand, flag, global option, and environment variable.
---

# CLI Reference

This is the exhaustive reference for `helyos`, the Helyos command-line interface. It talks to a running [`helyosd`](/docs/reference/daemon-flags) daemon over HTTP(S) and covers the full lifecycle: scaffolding projects, deploying and scaling services, managing secrets, routing and TLS, clustering and nodes, authentication, and connection contexts.

Commands are grouped below: [Core workflow](#core-workflow), [Projects](#projects), [Secrets](#secrets), [Routing and TLS](#routing-and-tls), [Cluster and nodes](#cluster-and-nodes), [Auth and contexts](#auth-and-contexts), and [System](#system). [Global flags](#global-flags) and [environment variables](#environment-variables) apply to every command.

:::tip

Every command supports `--help`. Run `helyos <command> --help` (or `helyos <command> <subcommand> --help`) to see its synopsis and flags inline. Use `helyos --version` to print the CLI version.

:::

## Global flags

These flags are accepted by every command and resolve connection settings. Precedence is **CLI flag > environment variable > config file > built-in default**.

```bash
--server <URL>      # helyosd server URL (env HELYOS_SERVER, or active context;
                    #   built-in default: http://localhost:6443)
--token <TOKEN>     # API bearer token (env HELYOS_API_TOKEN, or active context)
--context <NAME>    # Use a specific context for this command (overrides current-context)
--json              # Output results as JSON (for scripting and CI)
--help, -h          # Show help for the command
--version, -V       # Show the CLI version
```

:::note

When `--server` points at a non-loopback `http://` URL (anything other than `http://localhost:6443` or `http://127.0.0.1:6443`), the CLI prints a warning that traffic is unencrypted. Use an `https://` server for anything beyond local development. See [TLS & CA pinning](/docs/security/tls-ca-pinning).

:::

## Environment variables

| Variable | Purpose |
|---|---|
| `HELYOS_SERVER` | Default server URL, equivalent to `--server`. |
| `HELYOS_API_TOKEN` | Default API bearer token, equivalent to `--token`. Also used by `helyos login` when no `--token`/`--token-stdin` is given. |
| `HELYOS_CONFIG` | Override the config file path (default `~/.helyos/config.toml`). See [CLI config](/docs/reference/cli-config). |
| `NO_COLOR` | If set (to any value), disables colored output. See [no-color.org](https://no-color.org/). |

## Core workflow

The everyday commands for creating, deploying, observing, and tearing down services.

```bash
helyos init [NAME] [--image IMAGE]            # Scaffold a new project (interactive if NAME omitted)
helyos deploy <FILE> [--timeout SECS]         # Deploy a service from a YAML spec (default --timeout 60)
helyos status                                 # Show a cluster status overview
helyos top                                    # Live cluster dashboard (TUI)
helyos pods [-p|--project PROJECT]            # List all pods (optionally filtered by project)
helyos deployments [-p|--project PROJECT]     # List all deployments (optionally filtered by project)
helyos logs <NAME> [-p|--project PROJECT] [--tail N]   # Stream logs from a deployment
helyos scale <NAME> <REPLICAS> [-p|--project PROJECT]  # Scale a deployment to REPLICAS
helyos stop <NAME> [-p|--project PROJECT]              # Stop a deployment (scales to 0 / stops pods)
helyos rm <NAME> [-p|--project PROJECT] [-y|--yes]     # Remove a deployment (prompts unless --yes)
```

**`helyos init [NAME]`** scaffolds a project. With no `NAME` it prompts interactively; otherwise it writes the spec to `<name>/app.yaml`. Use `--image IMAGE` to preset the container image.

**`helyos deploy <FILE>`** applies a [deployment spec](/docs/reference/deployment-spec) (YAML). `--timeout SECS` is how long to wait for pods to become ready (default `60`).

**`helyos logs <NAME>`** streams container logs for a deployment. `--tail N` starts from the last `N` lines.

**`helyos rm`** and `helyos stop` accept `-p/--project` to disambiguate when a deployment name is not unique. `helyos rm` prompts for confirmation unless you pass `-y/--yes`.

```bash
# Scaffold, deploy, observe, scale, clean up
helyos init myapp --image nginx:alpine
helyos deploy myapp/app.yaml --timeout 120
helyos status
helyos logs api --project ecommerce --tail 100
helyos scale api 5 --project ecommerce
helyos rm api --project ecommerce --yes
```

:::note

For commands that take an optional `-p/--project`, if you omit it the CLI falls back to the active context's default project (set via `helyos login --project` or `helyos context set --project`). See [CLI config](/docs/reference/cli-config).

:::

## Projects

A project groups related deployments, secrets, and routes. Suspending a project stops all of its deployments. See [Projects](/docs/concepts/projects).

```bash
helyos project list                  # List all projects
helyos project create <NAME>         # Create a new project
helyos project suspend <NAME>        # Suspend a project (stops all its deployments)
helyos project resume <NAME>         # Resume a suspended project
helyos project delete <NAME> [-y|--yes]   # Delete a project and ALL its resources (prompts unless --yes)
```

```bash
helyos project create ecommerce
helyos project suspend ecommerce     # everything stops, state preserved
helyos project resume ecommerce
helyos project delete ecommerce -y
```

:::danger

`helyos project delete` removes the project **and all of its deployments, pods, secrets, and routes**. It prompts for confirmation unless you pass `-y/--yes`.

:::

## Secrets

Secrets are encrypted at rest and injected into containers as environment variables. The `-p/--project` flag is **required** for every secret subcommand. See [Secrets](/docs/guides/secrets) and [Secrets encryption](/docs/security/secrets-encryption).

```bash
helyos secret set <NAME> [--value VALUE] -p|--project PROJECT   # Store a secret
helyos secret list -p|--project PROJECT                          # List secret names
helyos secret rm <NAME> -p|--project PROJECT                     # Delete a secret
```

If you omit `--value`, the CLI reads the value from a non-echoing interactive prompt when run in a terminal, or from stdin (one line) when piped — keeping the secret out of your shell history.

```bash
# Interactive prompt (value not echoed)
helyos secret set DB_PASSWORD -p ecommerce

# Inline value (visible in shell history — avoid for real secrets)
helyos secret set API_KEY --value "sk-123" -p ecommerce

# From stdin / a file (recommended for automation)
echo -n "$DB_PASS" | helyos secret set DB_PASSWORD -p ecommerce

helyos secret list -p ecommerce
helyos secret rm DB_PASSWORD -p ecommerce
```

## Routing and TLS

Expose deployments on host-based routes through the built-in reverse proxy, with automatic TLS via ACME or your own imported certificate. See [Routing](/docs/guides/routing) and [TLS](/docs/guides/tls).

```bash
helyos routes [-p|--project PROJECT]     # List all routes (optionally filtered by project)

helyos route add <DOMAIN> -p|--project PROJECT --deployment NAME [--https]
                                         # Add a host route to a deployment; --https enables automatic TLS
helyos route rm <DOMAIN>                  # Remove a route by domain

helyos cert import <DOMAIN> --cert FILE --key FILE
                                         # Import a TLS certificate (PEM cert + private key) for a domain
```

```bash
# Route api.example.com to the "api" deployment with automatic Let's Encrypt TLS
helyos route add api.example.com -p ecommerce --deployment api --https

# Bring your own certificate instead
helyos cert import api.example.com --cert ./fullchain.pem --key ./privkey.pem

helyos routes -p ecommerce
helyos route rm api.example.com
```

:::tip

`--https` requests automatic certificates via ACME (Let's Encrypt). For ACME to issue certs, the daemon needs an account email — start `helyosd` with `--acme-email`. See [TLS](/docs/guides/tls).

:::

## Cluster and nodes

Initialize a cluster, manage the worker join token, tune the scheduler, and operate nodes. See [Clustering](/docs/guides/clustering) and [Scheduling](/docs/concepts/scheduling).

```bash
helyos cluster init                          # Initialize the cluster and generate a join token
helyos cluster token show                    # Show the current join token
helyos cluster token rotate                  # Rotate the join token (invalidates the old one)
helyos cluster config get-scheduler          # Show the current scheduler configuration
helyos cluster config set <KEY> <VALUE>      # Set scheduler strategy or an individual weight

helyos nodes                                 # List cluster nodes
helyos node drain <NAME>                      # Drain a node (stop scheduling new pods onto it)
helyos node rm <NAME>                          # Remove a node from the cluster
```

For `cluster config set`, the `KEY` is either:

- `scheduler` — set the strategy; `VALUE` is `spread` (default) or `binpack`.
- `scheduler.weights.<name>` — set an individual weight; `VALUE` is a number. Weight names are `cpu`, `memory`, `load`, and `failure`.

```bash
# Bring up a cluster and hand the join token to workers
helyos cluster init
helyos cluster token show

# Prefer packing pods densely onto fewer nodes
helyos cluster config set scheduler binpack
helyos cluster config set scheduler.weights.cpu 2.0
helyos cluster config get-scheduler

# Drain then remove a node for maintenance
helyos node drain worker-2
helyos node rm worker-2
```

:::note

Workers authenticate to the master with the **join token** (prefix `nxa_`), not a client certificate. Rotating the token with `helyos cluster token rotate` invalidates the previous one. See [Clustering](/docs/guides/clustering).

:::

## Auth and contexts

Manage server-side API tokens, log in to remote clusters, and switch between named connection contexts (kubectl-style). See [Remote access](/docs/guides/remote-access), [API tokens](/docs/security/api-tokens), and [CLI config](/docs/reference/cli-config).

### Login and identity

```bash
helyos login <SERVER> [flags]    # Pin the daemon's CA and store a context
helyos logout [NAME]             # Drop the token from a context (active by default); keeps server + pinned CA
helyos whoami                    # Show the identity of the active token
```

`helyos login <SERVER>` accepts a full URL or a bare host (it assumes `https://` and port `:6443` when omitted). On success it validates the token against the daemon, pins the CA, stores a context, and makes it active.

```bash
--name <NAME>                  # Context name (default: derived from the host)
--token <TOKEN>                # API token (else --token-stdin, $HELYOS_API_TOKEN, or interactive prompt)
--token-stdin                  # Read the API token from stdin (one line)
--ca-file <PEM>                # Trust this CA PEM file instead of fetching it (out-of-band)
--ca-fingerprint <SHA256>      # Require the fetched CA to match this SHA-256 (fail-closed, no prompt)
--insecure-skip-tls-verify     # Skip TLS verification entirely (insecure)
--project <NAME>               # Default project for this context
--no-set-current               # Do not switch the active context to this one
```

```bash
# Trust-on-first-use: pin the daemon's self-signed CA and store a context
helyos login cluster.example.com --token nxa-api_xxxxxxxx

# CI / non-interactive: read the token from stdin and verify the CA fingerprint fail-closed
echo "$HELYOS_API_TOKEN" | helyos login https://cluster.example.com:6443 \
  --token-stdin \
  --ca-fingerprint 9f:86:d0:81:... \
  --name prod --project web

helyos whoami            # confirm the active identity
helyos logout prod       # drop the token but keep the server + pinned CA
```

### Contexts

A context bundles a server URL, token, pinned CA, and default project. The active context supplies connection settings when no flag or env var overrides them.

```bash
helyos context ls                                # List contexts (alias: list); * marks the active one
helyos context use <NAME>                        # Switch the active context
helyos context current                           # Show the active context
helyos context rename <OLD> <NEW>                # Rename a context
helyos context set <NAME> [--server URL] [--project NAME]   # Edit a context's fields
helyos context rm <NAME>                          # Remove a context
```

```bash
helyos context ls
helyos context use prod
helyos context set prod --server https://new-host:6443 --project web
helyos --context staging status     # override the active context for one command
helyos context rm old-cluster
```

### Server-side API tokens

These commands manage tokens on the daemon, through the active context's connection. See [API tokens](/docs/security/api-tokens).

```bash
helyos auth token create <NAME> [--ttl SECS]   # Create a named token (secret shown ONCE; --ttl = expiry in seconds)
helyos auth token ls                            # List API tokens (alias: list)
helyos auth token revoke <NAME>                 # Revoke an API token by name
```

```bash
# Create a CI token that expires in one hour (secret is printed once — copy it now)
helyos auth token create ci --ttl 3600
helyos auth token ls
helyos auth token revoke ci
```

:::warning

The token secret is shown **only once** at creation time and is never stored in plaintext (the daemon keeps Argon2id hashes). If you lose it, revoke the token and create a new one.

:::

## System

Helper commands for host setup and shell integration.

```bash
helyos setup cni [--bin-dir DIR] [--version VER]   # Download and install standard CNI plugins
helyos completions <SHELL>                          # Generate shell completions
```

**`helyos setup cni`** downloads standard CNI plugin binaries. Defaults: `--bin-dir /var/lib/helyos/cni/bin`, `--version 1.4.1`.

**`helyos completions <SHELL>`** prints a completion script to stdout. Supported shells: `bash`, `zsh`, `fish`, `powershell`, `elvish`.

```bash
# Install CNI plugins to a custom directory
helyos setup cni --bin-dir /opt/cni/bin --version 1.4.1

# Enable shell completions (bash example)
helyos completions bash > /etc/bash_completion.d/helyos

# zsh example
helyos completions zsh > "${fpath[1]}/_helyos"
```

:::warning

CNI plugin support is **experimental** and not yet production-ready. See [Networking](/docs/guides/networking).

:::

## JSON output

Pass `--json` (a global flag) to emit machine-readable JSON instead of formatted tables. This is the recommended mode for scripting and CI/CD.

```bash
helyos --json deployments -p ecommerce
helyos --json pods | jq '.[] | select(.status == "Running") | .name'
```

## Next steps

- [Deployment spec reference](/docs/reference/deployment-spec) — every field accepted by `helyos deploy`.
- [CLI config](/docs/reference/cli-config) — the `~/.helyos/config.toml` format and context resolution.
- [Daemon flags](/docs/reference/daemon-flags) — configuring `helyosd`.
- [REST API](/docs/reference/rest-api) — the endpoints the CLI calls under the hood.

## See also

- [Remote access](/docs/guides/remote-access) — log in to and manage remote clusters.
- [API tokens](/docs/security/api-tokens) and [TLS & CA pinning](/docs/security/tls-ca-pinning) — the security model behind `login` and `auth token`.
- [Quickstart](/docs/getting-started/quickstart) — a guided first run.
