---
sidebar_position: 1
title: "Installation"
description: Install Helyos with the one-line installer or build from source, then verify the daemon and CLI are working.
---

# Installation

Helyos ships as two binaries: `helyosd` (the daemon) and `helyos` (the CLI). This page walks you through installing both, choosing how the daemon runs, and verifying everything works.

## Quick install (recommended)

The fastest way to get Helyos is the one-line installer:

```bash
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh
```

The installer:

- Downloads both `helyosd` and `helyos` and installs them to `/usr/local/bin` (verifying the SHA-256 checksum of each artifact).
- Installs an **auto-start service** so the daemon launches on login — `launchd` on macOS, a `systemd --user` unit on Linux.
- **Launches `helyosd`** immediately and waits for it to answer on `http://localhost:6443`.
- Adds the install directory to your `PATH` if it is not already there.

On first start, the daemon generates an API token (logged once), writes a ready-to-use local CLI context to `~/.helyos/config.toml`, and serves the API. Local use is zero-config: once `helyosd` is running, the `helyos` CLI just works against it with no flags or setup.

:::info 
Where things live
Binaries go to `/usr/local/bin` (or `~/.helyos/bin` if that directory is not writable and you are not root). Data, logs, and the local CLI context live under `~/.helyos`.
:::

### Supported platforms

| OS | Architectures |
|---|---|
| Linux | amd64, arm64 |
| macOS | amd64 (Intel), arm64 (Apple Silicon) |

The installer requires `curl` and `tar`, which are present on virtually every system.

### Installer environment variables

You can tune the installer by setting environment variables before the pipe:

| Variable | Effect |
|---|---|
| `NO_SERVICE=1` | Skip installing the auto-start service. The daemon is still launched once unless `NO_START=1`. |
| `INSTALL_DIR=/path` | Install the binaries somewhere other than `/usr/local/bin`. |
| `NO_START=1` | Install everything but do not launch `helyosd` afterwards. |
| `VERSION=0.3.2` | Install a specific release instead of the latest. |
| `FORCE=1` | Overwrite an existing install without prompting. |

For example, to install into a user-owned directory without registering a background service:

```bash
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh \
  | NO_SERVICE=1 INSTALL_DIR="$HOME/.local/bin" sh
```

:::tip 
Running the daemon yourself
With `NO_SERVICE=1`, nothing manages the daemon for you. Start it manually with `helyosd`, or run it under your own process supervisor. See [Daemon flags](/docs/reference/daemon-flags) for the full set of options.
:::

### Managing the auto-start service

If you let the installer register a service, you can control it with the platform's native tools.

On **macOS** (launchd):

```bash
# Stop
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/net.helyos.helyosd.plist
# Restart
launchctl kickstart -k gui/$(id -u)/net.helyos.helyosd
```

On **Linux** (systemd user unit):

```bash
systemctl --user stop helyosd       # stop
systemctl --user restart helyosd    # restart
journalctl --user -u helyosd -f     # follow logs
```

### Updating

Re-run the same install command at any time. The installer detects an existing version, stops the running daemon, replaces the binaries, and restarts. When piped (non-interactive), it updates automatically; in a terminal it prompts before overwriting.

### Uninstalling

The installer doubles as an uninstaller. It removes the service and binaries but **preserves your data** under `~/.helyos`:

```bash
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh -s -- --uninstall
```

To remove everything, including projects and state, delete the data directory afterwards:

```bash
rm -rf ~/.helyos
```

## Build from source

Prefer to build locally? Both binaries are standard Cargo projects.

### Prerequisites

- **Rust toolchain** — edition 2024. The CLI requires Rust **1.85+** and the daemon (`helyosd`) requires Rust **1.88+**; build with the daemon's MSRV to cover both.
- **A container runtime on the host** — Docker or containerd. The daemon auto-detects which is available at startup; without one, deployments cannot run.

Install Rust via [rustup](https://rustup.rs) if you don't already have it:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Build the binaries

```bash
# Daemon (requires Rust 1.88+)
git clone https://github.com/helyos-labs/helyosd.git
cd helyosd && cargo build --release
# binary at ./target/release/helyosd

# CLI (requires Rust 1.85+)
git clone https://github.com/helyos-labs/helyos-cli.git
cd helyos-cli && cargo build --release
# binary at ./target/release/helyos
```

Copy the resulting binaries somewhere on your `PATH`:

```bash
sudo install -m 755 helyosd/target/release/helyosd /usr/local/bin/helyosd
sudo install -m 755 helyos-cli/target/release/helyos /usr/local/bin/helyos
```

:::note 
No service when building from source
A source build does not register an auto-start service. Start the daemon with `helyosd` (see [Quickstart](/docs/getting-started/quickstart)), or wire up your own `systemd`/`launchd` unit.
:::

## Verify the install

Confirm both binaries are present and report their versions:

```bash
helyosd --version
helyos --version
```

If you used the quick installer, the daemon is already running. Check its health and ask the CLI for cluster status:

```bash
# Liveness probe (public endpoint, no auth required)
curl -sf http://localhost:6443/health

# Cluster overview through the CLI (uses the zero-config local context)
helyos status
```

A healthy local install responds to `/health` and `helyos status` returns cluster info without any extra configuration.

:::tip 
Find the API token
The daemon logs its auto-generated API token exactly once on first start, as `HELYOS_API_TOKEN=...`. On macOS the installer writes logs to `~/.helyos/log/helyosd.log`; on Linux read them with `journalctl --user -u helyosd`. You'll need this token to drive a remote cluster — see [Remote access](/docs/guides/remote-access).
:::

## Next steps

- [Quickstart](/docs/getting-started/quickstart) — start the daemon and deploy a service in minutes.
- [First deployment](/docs/getting-started/first-deployment) — write your first deployment spec end to end.
- [Daemon flags](/docs/reference/daemon-flags) — every `helyosd` option, including TLS and clustering.
