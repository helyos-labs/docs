# Helyos Documentation

The source for the [Helyos](https://github.com/helyos-labs/helyos) documentation
site, built with [Docusaurus](https://docusaurus.io/).

## Develop

```bash
npm install      # install dependencies
npm start        # start the dev server at http://localhost:3000
```

## Build

```bash
npm run build    # static build into ./build
npm run serve    # preview the production build locally
```

`npm run build` fails on broken links, so a green build means the docs are
internally consistent.

## Structure

Content lives under `docs/`, organized into categories that map 1:1 to the
sidebar:

| Folder | Section |
|---|---|
| `introduction/` | What Helyos is, comparisons, how it works |
| `getting-started/` | Installation, quickstart, first deployment |
| `concepts/` | Projects, deployments, scheduling, health, DNS |
| `guides/` | Task-oriented how-tos |
| `reference/` | CLI, deployment spec, REST API, daemon flags, config |
| `security/` | Security model, tokens, TLS, secrets |

## License

Documentation is licensed under [Apache-2.0](https://github.com/helyos-labs/helyos/blob/main/LICENSE).
