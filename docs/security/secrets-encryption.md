---
sidebar_position: 4
title: "Secrets Encryption"
description: How Helyos encrypts secrets at rest with AES-256-GCM, derives a per-node master key, and injects values into containers as environment variables.
---

# Secrets Encryption

Helyos stores project secrets encrypted at rest and injects them into your containers as environment variables at deploy time. This page explains the cryptography, where the keys and data live on disk, and what that means for backups and operations.

If you just want to set and use secrets, start with the [Secrets guide](/docs/guides/secrets). This page covers how the protection works under the hood.

## How secrets are protected

The daemon encrypts every secret value with **AES-256-GCM** (a 256-bit AEAD cipher) before it is written to disk. The encrypted values live in a dedicated SQLite database, `secrets.db`, inside the daemon's data directory.

The flow for a single secret is:

1. You set a value with `helyos secret set` (or `POST /api/v1/projects/{p}/secrets/{name}`).
2. The daemon generates a fresh random 96-bit (12-byte) nonce and encrypts the plaintext with the node's master key.
3. The stored blob is `nonce (12 bytes) || ciphertext`, written to the `secrets` table keyed by `(project, name)`.
4. On read, the daemon splits off the nonce, decrypts, and returns the plaintext.

Each `set` uses a new nonce, so writing the same value twice produces different ciphertext on disk. GCM is authenticated: if the ciphertext is tampered with, or you try to decrypt with the wrong key, decryption fails rather than returning garbage.

:::info
Plaintext secret values are never written to disk. They exist only in memory during encryption, decryption, and injection into a container.
:::

## The per-node master key

Encryption uses a single **per-node master key**: 32 random bytes (256 bits) generated from the operating system's secure RNG the first time the daemon starts.

- The key is stored at `master.key` inside the data directory (`~/.helyos/data/master.key` by default).
- On Unix it is written with `0600` permissions (owner read/write only).
- On every subsequent start the daemon loads the existing key; it only generates a new one if `master.key` is absent.
- The key is auto-generated. There is no passphrase to remember and no key-management service to configure.

```text
~/.helyos/data/
├── master.key      # 32-byte AES-256 master key (0600)
├── secrets.db      # AES-256-GCM encrypted secret values
└── ...             # helyos.db, routes.db, certs, proxy config, etc.
```

The location follows `--data-dir`. If you run the daemon with `--data-dir /var/lib/helyos`, the key and encrypted store live under `/var/lib/helyos`.

:::danger
The master key and the encrypted database are a matched pair. If you lose `master.key`, every value in `secrets.db` becomes permanently unrecoverable. If you replace the key file, existing secrets will fail to decrypt. Treat `master.key` as the most sensitive file in the data directory.
:::

Because the key is generated per node, each daemon has its own independent key. There is no shared cluster-wide secret encryption key, so an encrypted `secrets.db` copied from one node cannot be decrypted on another.

## Scope: secrets are per project

Secrets are namespaced by **project**. Every secret is keyed by `(project, name)`, so the same name (for example `DB_PASSWORD`) can hold different values in different projects, and projects cannot read each other's secrets.

```bash
# Same name, isolated per project
helyos secret set DB_PASSWORD --value prod-pw  -p store-prod
helyos secret set DB_PASSWORD --value stage-pw -p store-stage

helyos secret list -p store-prod    # shows DB_PASSWORD (prod)
helyos secret list -p store-stage   # shows DB_PASSWORD (stage)
```

Listing returns only secret **names**, never values. There is no API or CLI command that reads a secret value back out.

## Injection as environment variables

Secrets are delivered to your containers as environment variables. You reference them by name in a deployment's `secrets` list, and the daemon resolves each one against the secret store for that project at deploy time and merges it into the container environment.

```yaml
project: store-prod
deployment:
  name: api
image: ghcr.io/acme/api:1.4.0
env:
  LOG_LEVEL: info
secrets:
  - DB_PASSWORD
  - STRIPE_KEY
```

At deploy, the container receives `DB_PASSWORD` and `STRIPE_KEY` as environment variables alongside the plain `env` entries. A few rules apply:

- The named secret must exist in the deployment's project, or the deploy is rejected.
- Secret values are decrypted in memory and merged into the container environment; they are not logged.
- Values must be valid UTF-8 when injected as environment variables.

See the [Secrets guide](/docs/guides/secrets) for the full set/list/remove workflow and the [Deployment Spec reference](/docs/reference/deployment-spec) for the `secrets` field.

:::tip
To set a secret without exposing it in your shell history, omit `--value`. In an interactive terminal you'll be prompted; otherwise the value is read from stdin:

```bash
printf '%s' "$DB_PASSWORD" | helyos secret set DB_PASSWORD -p store-prod
```
:::

## Operational notes

### Back up the key and the store together

Encryption at rest only protects you if you can still decrypt later. A usable backup must include **both** `master.key` and `secrets.db` from the same data directory. Backing up `secrets.db` alone is useless without its key, and backing up the key alone does not preserve your secrets.

```bash
# Stop the daemon (or snapshot a quiet moment), then archive the pair
tar czf helyos-secrets-backup.tgz \
  -C ~/.helyos/data master.key secrets.db
```

Store that archive somewhere at least as protected as the secrets themselves, since anyone holding both files can decrypt every value.

### Protect the data directory

The master key file is created with `0600` on Unix, but the surrounding data directory and your backups are your responsibility. Restrict access to `--data-dir` to the user that runs the daemon, and apply the same care to any backup copies.

### Rotating the master key

There is no built-in command to re-key the existing store. Replacing `master.key` invalidates everything in `secrets.db`. If you need to rotate, plan to re-set each secret after generating a new key (for example, by clearing the secret store and re-applying values from your source of truth), rather than swapping the key file under a populated database.

### Secrets in transit

Encryption at rest protects values on disk. To protect them in transit, talk to the daemon over HTTPS. On a non-loopback bind the API is HTTPS by default, and the CLI warns when it would send secrets or tokens over plain HTTP. See [TLS &amp; CA Pinning](/docs/security/tls-ca-pinning) for how the daemon's certificate works.

## See also

- [Secrets guide](/docs/guides/secrets) — set, list, and use secrets in deployments
- [Deployment Spec reference](/docs/reference/deployment-spec) — the `secrets` and `env` fields
- [Security model](/docs/security/security-model) — overall threat model and defaults
- [TLS &amp; CA Pinning](/docs/security/tls-ca-pinning) — protecting secrets in transit
- [Daemon flags reference](/docs/reference/daemon-flags) — `--data-dir` and related options
