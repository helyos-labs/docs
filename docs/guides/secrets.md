---
sidebar_position: 2
title: "Manage Secrets"
description: Create, list, and remove per-project secrets, then reference them in a deployment so they are injected as environment variables.
---

# Manage Secrets

Secrets let you keep sensitive values such as database passwords, API keys, and tokens out of your deployment specs and out of version control. In Helyos, secrets are scoped to a project, stored encrypted at rest, and injected into your containers as environment variables at deploy time.

This guide shows you how to create, list, and remove secrets with the `helyos` CLI, and how to reference them from a deployment spec.

## How secrets work

A secret in Helyos is a named key/value pair that belongs to a single project:

- **Scoped to a project.** Secrets are addressed as `<project>/<name>`. Two projects can each have a secret named `DB_PASSWORD` without colliding, and a deployment can only reference secrets from its own project.
- **Encrypted at rest.** Values are encrypted with AES-256-GCM using a per-node master key before they are written to disk. The plaintext value is never persisted. See [Secrets encryption](/docs/security/secrets-encryption) for the full design.
- **Injected as environment variables.** When you list a secret in a deployment's `secrets:` field, its value is decrypted and merged into the container environment, using the secret name as the environment variable name.

:::info
Secret names are used verbatim as environment variable names, so choose names that are valid environment variables (for example `DB_PASSWORD`, not `db password`). Values must be valid UTF-8.
:::

## Prerequisites

- A running `helyosd` daemon. When you install Helyos, the daemon starts automatically and writes a local CLI context to `~/.helyos/config.toml`, so the `helyos` CLI works against it with no extra setup.
- A project to hold the secrets. You can create one explicitly, or it is created on first deploy.

```bash
helyos project create myapp
```

## Create a secret

Use `helyos secret set` to create or update a secret. The `-p`/`--project` flag is required.

Pass the value inline with `--value`:

```bash
helyos secret set DB_PASSWORD --value "s3cr3t-pa55" -p myapp
```

:::warning
A value passed with `--value` is visible in your shell history and process list. For sensitive values, prefer the prompt or stdin methods below.
:::

If you omit `--value` and you are at an interactive terminal, the CLI prompts for the value without echoing it:

```bash
helyos secret set DB_PASSWORD -p myapp
# Value for secret 'DB_PASSWORD': (input hidden)
```

If you omit `--value` and stdin is not a terminal, the value is read from stdin. This is handy in scripts and pipelines:

```bash
printf '%s' "$DB_PASSWORD" | helyos secret set DB_PASSWORD -p myapp
```

Running `helyos secret set` again for an existing name overwrites the stored value.

:::tip
Reading from stdin avoids leaking the value into shell history. The CLI reads a single line and strips trailing whitespace (including the trailing newline), so `echo "$DB_PASSWORD"` works too; using `printf` (or `echo -n`) to avoid adding a newline in the first place is still the safer habit.
:::

## List secrets

List the secret names in a project with `helyos secret list`. Only names are returned, never values.

```bash
helyos secret list -p myapp
```

```text
 Secrets                                                           1 total

 Name          Project
 DB_PASSWORD   myapp
```

For scripting, add the global `--json` flag to get machine-readable output:

```bash
helyos secret list -p myapp --json
```

```json
{
  "project": "myapp",
  "secrets": ["DB_PASSWORD"]
}
```

:::note
There is no command to read a secret's value back. Once set, a value can only be used (by injecting it into a deployment) or replaced; it is never exposed through the API or CLI.
:::

## Remove a secret

Delete a secret by name with `helyos secret rm`:

```bash
helyos secret rm DB_PASSWORD -p myapp
```

Removing a secret does not affect already-running containers, which keep the environment they were started with. The change takes effect the next time an affected deployment is created or redeployed. A deploy that references a secret which no longer exists will fail (see [Troubleshooting](#troubleshooting)).

## Reference a secret in a deployment

To inject a secret into your containers, list its name under the `secrets:` field of your deployment spec. The deployment must belong to the same project as the secret.

```yaml
project: myapp
deployment:
  name: api
replicas: 2
image: myorg/api:1.4.0
ports:
  - 8080
env:
  LOG_LEVEL: info
secrets:
  - DB_PASSWORD
  - STRIPE_API_KEY
```

When this spec is deployed, Helyos decrypts `DB_PASSWORD` and `STRIPE_API_KEY` from project `myapp` and merges them into the container environment. Inside the container they appear as ordinary environment variables:

```bash
echo "$DB_PASSWORD"   # the decrypted secret value
```

:::note
Secrets are merged into the environment on top of the static `env:` map. If a secret name matches a key already defined in `env:`, the secret value wins. To avoid confusion, do not define the same name in both places.
:::

Deploy as usual:

```bash
helyos deploy app.yaml
```

The `secrets:` field is a list of strings; each string must be the name of an existing secret in the deployment's project. For the full set of deployment fields, see the [Deployment spec reference](/docs/reference/deployment-spec).

## Encryption at rest

Helyos encrypts every secret value with **AES-256-GCM** before storing it. On first start, the daemon generates a random 256-bit master key, writes it to `master.key` in its data directory (`~/.helyos/data` by default) with `0600` permissions, and reuses it on subsequent starts. Each secret is encrypted with a fresh random nonce, and the ciphertext is stored in an SQLite database. Plaintext values are never written to disk.

:::danger
The master key file (`master.key`) protects every secret on the node. Anyone who can read both the key file and the secrets database can decrypt your secrets. Restrict access to the daemon's data directory and back up `master.key` securely: if you lose it, the encrypted secrets become unrecoverable.
:::

For the encryption scheme, key handling, and threat model in detail, see [Secrets encryption](/docs/security/secrets-encryption).

## Troubleshooting

**Deploy fails with "secret not found in project".** The deployment references a secret name that does not exist in its project. Check the spelling and project, then confirm it exists:

```bash
helyos secret list -p myapp
```

**Deploy fails with "secret contains invalid UTF-8".** Secret values are injected as environment variable strings and must be valid UTF-8. Store binary data as text first (for example, base64-encode it) and decode it inside your application.

**A secret update did not take effect.** Running containers keep their original environment. Redeploy the affected deployment so new pods pick up the new value:

```bash
helyos deploy app.yaml
```

## Next steps

- [Deploy a Service](/docs/guides/deploy-a-service) — the full deployment lifecycle, including `env:`, volumes, and health checks.
- [Deployment spec reference](/docs/reference/deployment-spec) — every field you can set in `app.yaml`.
- [Secrets encryption](/docs/security/secrets-encryption) — how AES-256-GCM and the master key protect secrets at rest.
- [CLI reference](/docs/reference/cli) — all `helyos` commands and flags.
