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
| `introduction/` | What Helyos is, comparisons, architecture |
| `getting-started/` | Installation, quickstart, first deployment |
| `concepts/` | Projects, deployments, scheduling, health, DNS |
| `guides/` | Task-oriented how-tos |
| `reference/` | CLI, deployment spec, REST API, daemon flags, config |
| `security/` | Security model, tokens, TLS, secrets |
| `project/` | Internals, repositories, contributing |

The sidebar is generated automatically from this structure
(`sidebars.ts` + each folder's `_category_.json`). Page order within a category
is set by the `sidebar_position` front matter on each page. Search is provided
offline by `@easyops-cn/docusaurus-search-local` — no external service required.

## Deployment

CI (`.github/workflows/deploy.yml`) builds on every push and pull request.
Publishing is intentionally opt-in so the hosting target can be chosen later:

- **GitHub Pages** — set `url`/`baseUrl` in `docusaurus.config.ts` for project
  pages (`url: https://helyos-labs.github.io`, `baseUrl: /docs/`), enable Pages
  (Settings → Pages → Source: *GitHub Actions*), and add the repository variable
  `ENABLE_PAGES=true`.
- **Custom domain / Vercel / Netlify** — keep `baseUrl: '/'`, point `url` at your
  domain, and connect the repo to your host (or adapt the deploy job).

## License

Documentation is licensed under [Apache-2.0](https://github.com/helyos-labs/helyos/blob/main/LICENSE).
