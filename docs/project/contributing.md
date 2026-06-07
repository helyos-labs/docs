---
sidebar_position: 3
title: "Contributing"
description: How to contribute to Helyos — clone a repo, pass CI (fmt, clippy, tests), open a pull request, file issues, and the Apache-2.0 license.
---

# Contributing

Helyos is open source under the [Apache-2.0](#license) license, and contributions are welcome — bug fixes, new features, documentation, and tests. This page covers the practical workflow: which repository to clone, what the CI pipeline expects, how to open a pull request, and where to file issues.

Helyos is a multi-repo project under the [`helyos-labs`](https://github.com/helyos-labs) GitHub organization. Before you start, read the [Repositories](/docs/project/repositories) page to find the right repo for your change, and the [Architecture deep dive](/docs/project/architecture-deep-dive) to understand how the pieces fit together.

## Pick the right repository

Each component lives in its own repository with its own CI pipeline, version, and issue tracker. Open your pull request against the repo that owns the code you are changing.

| Repository | What lives here | When to contribute here |
|:--|:--|:--|
| [`helyos-core`](https://github.com/helyos-labs/helyos-core) | Domain models, port traits, the actor-model orchestrator | Core types, scheduling logic, port interfaces |
| [`helyosd`](https://github.com/helyos-labs/helyosd) | The daemon: runtime adapters, REST API, gRPC clustering, storage | Docker/containerd adapters, REST endpoints, persistence, networking |
| [`helyos-cli`](https://github.com/helyos-labs/helyos-cli) | The `helyos` command-line interface | CLI commands, output formatting, contexts and login |
| [`helyos`](https://github.com/helyos-labs/helyos) | Meta repo: install script, specs, top-level docs | The installer, project-wide documentation, specs |

:::tip

A change to `helyosd` or `helyos-cli` sometimes needs a corresponding change in `helyos-core` first (for example, adding a new port method). If so, land the `helyos-core` change first, then update the dependent repo to use the published version.

:::

## Prerequisites

To build and test Helyos locally you need:

- **Rust** (stable toolchain via [`rustup`](https://rustup.rs)). All crates use **edition 2024**. The minimum supported Rust version is **1.85** for `helyos-core` and `helyos-cli`, and **1.88** for `helyosd`. Running `rustup update stable` keeps you current.
- The **`clippy`** and **`rustfmt`** components — install with `rustup component add clippy rustfmt`.
- **`protoc`** (the Protocol Buffers compiler), required to build `helyosd` because it compiles the gRPC clustering protos. Install via `apt-get install protobuf-compiler` on Debian/Ubuntu or `brew install protobuf` on macOS.
- **Docker or containerd** running on the host, if you want to run the integration and end-to-end tests in `helyosd` (the daemon talks to a real container runtime).

## Clone and build

Clone the repository you want to work on and build it with Cargo:

```bash
# Core library
git clone https://github.com/helyos-labs/helyos-core.git
cd helyos-core && cargo build

# Daemon (needs protoc on PATH)
git clone https://github.com/helyos-labs/helyosd.git
cd helyosd && cargo build

# CLI
git clone https://github.com/helyos-labs/helyos-cli.git
cd helyos-cli && cargo build
```

For a release-optimized binary, use `cargo build --release` — the artifact lands in `target/release/`.

## CI expectations

Every repository runs the same core checks on every push and pull request to `main`. Run them locally before you push; a green local run is the fastest way to a green PR.

```bash
cargo fmt --check            # formatting must match rustfmt
cargo clippy -- -D warnings  # zero clippy warnings (warnings are errors)
cargo test                   # all tests must pass
```

The CI pipeline enforces these in separate jobs:

- **Check** — runs `cargo fmt --check` and `cargo clippy -- -D warnings`. Note the `-D warnings`: any clippy lint is a hard failure, not a warning. `helyos-core` additionally runs `cargo doc --no-deps` so doc comments must compile.
- **Test** — runs `cargo test` on both `ubuntu-latest` and `macos-latest`. In `helyosd` the unit suite is split out as `cargo test --lib`, with separate integration jobs (see below).
- **Security Audit** — runs `cargo audit` against the dependency tree. A small set of advisories with no clean upstream fix are explicitly ignored in CI; do not introduce new vulnerable dependencies.
- **Coverage** — produces an `lcov.info` report. This is informational and does not gate merges.

:::warning

CI treats formatting and clippy as gates. The most common reason a PR goes red is a missing `cargo fmt` run. Always run `cargo fmt` (not just `--check`) to auto-apply formatting before committing.

:::

### Tests in `helyosd`

Because the daemon drives a real container runtime, its test suite is layered. When you change daemon behavior, run the layer your change touches:

```bash
cargo test --lib                                   # fast unit tests (no Docker)
cargo test --test api_integration                  # REST API integration
cargo test --test sqlite_integration               # storage integration
docker pull busybox:latest                          # pull the test image first
cargo test --test runtime_integration -- --ignored # exercises the container runtime
```

The end-to-end suite (`cargo test --test e2e -- --ignored --test-threads=1`) requires Docker and a `busybox:latest` image. It runs on push to `main` in CI; run it locally if your change affects the full deploy path.

## Code style

Follow the conventions already in the codebase so your change reads like the rest of the tree:

- Match existing patterns in the module you are editing.
- Use [`parking_lot`](https://docs.rs/parking_lot) locks instead of `std::sync::Mutex`/`RwLock`.
- Use [`anyhow`](https://docs.rs/anyhow) for application errors and [`thiserror`](https://docs.rs/thiserror) for library error types.
- Prefer [`tracing`](https://docs.rs/tracing) macros over `println!` for diagnostic output.
- Write tests for new functionality, and keep new code inside the right [hexagonal layer](/docs/project/architecture-deep-dive) — domain logic in `domain/`, interfaces in `ports/`, concrete implementations in `adapters/`.

## Pull request workflow

1. **Fork** the repository (or push a branch if you have write access) and create a topic branch off `main`:

   ```bash
   git checkout -b fix/scheduler-weight-parsing
   ```

2. **Make your change**, including tests for new behavior and an update to the relevant `README.md` or docs if you change user-facing behavior, flags, endpoints, or the deployment spec.

3. **Run the full local check** before pushing:

   ```bash
   cargo fmt
   cargo clippy -- -D warnings
   cargo test
   ```

4. **Write a clear commit message.** Use a concise, imperative summary line (for example, `fix: parse scheduler weights as floats`) and explain the *why* in the body when it is not obvious.

5. **Open the pull request** against `main` of the same repository. Describe what changed and why, link any related issue, and note how you tested it. Keep PRs focused — one logical change per PR is easier to review and merge.

6. **Respond to review.** CI runs automatically on your PR; push fixups to the same branch until every check is green and a maintainer approves.

:::note

If your change spans more than one repository (for example, a new port method in `helyos-core` consumed by `helyosd`), mention the companion PR in your description so reviewers can land them in the right order.

:::

## Reporting issues

File issues on the repository that owns the affected component — the [Repositories](/docs/project/repositories) table tells you which one. A good report includes:

- **Steps to reproduce** — the exact commands or deployment spec that trigger the problem.
- **Expected vs. actual behavior.**
- **Versions** — output of `helyos --version` and `helyosd --version`.
- **Environment** — operating system, architecture, and container runtime (Docker or containerd).

For deployment problems, attach the relevant spec and the daemon logs. For security-sensitive reports, follow the disclosure guidance in the affected repository rather than opening a public issue.

## License

Helyos is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). By contributing, you agree that your contributions will be licensed under the same terms. Each repository ships a `LICENSE` file with the full text, and the [`helyos`](https://github.com/helyos-labs/helyos) meta repo also carries a `NOTICE` file with the copyright attribution.

## See also

- [Repositories](/docs/project/repositories) — what lives in each repo and how they fit together.
- [Architecture deep dive](/docs/project/architecture-deep-dive) — the hexagonal ports-and-adapters design you will be working within.
- [CLI reference](/docs/reference/cli) and [Daemon flags](/docs/reference/daemon-flags) — keep these in sync when you change user-facing behavior.
