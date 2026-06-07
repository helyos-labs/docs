import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// Prism code themes tuned to the Navigator palette. Dracula's default dark
// background (#282A36) is a purple-grey that clashes with the blue-night theme,
// so we re-base it on a deep blue; the light theme is nudged to match as well.
const codeThemeLight = {
  ...prismThemes.github,
  plain: {...prismThemes.github.plain, backgroundColor: '#f4f7fc'},
};
const codeThemeDark = {
  ...prismThemes.dracula,
  plain: {...prismThemes.dracula.plain, backgroundColor: '#0f1a33'},
};

const config: Config = {
  title: 'Helyos',
  tagline: '80% of Kubernetes use-cases with 20% of the complexity',
  favicon: 'img/favicon.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // ── Deployment URL ──────────────────────────────────────────────────────
  // Hosting is not finalized yet. The defaults below produce clean URLs for a
  // custom domain or Vercel/Netlify (baseUrl '/'). To switch targets:
  //   • Custom domain (e.g. https://docs.helyos.dev):
  //       url: 'https://docs.helyos.dev',   baseUrl: '/'
  //   • GitHub project pages (helyos-labs.github.io/docs):
  //       url: 'https://helyos-labs.github.io',   baseUrl: '/docs/'
  url: 'https://helyos-labs.github.io',
  baseUrl: '/',

  organizationName: 'helyos-labs',
  projectName: 'docs',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // `.md` files are parsed as CommonMark (lenient about `{` and `<`); `.mdx`
  // files still get full MDX/JSX. Keeps hand-written docs robust to build.
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Brand typography: Bricolage Grotesque (display) + Hanken Grotesk (body) + JetBrains Mono (code).
  headTags: [
    {
      tagName: 'link',
      attributes: {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
    },
    {
      tagName: 'link',
      attributes: {rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous'},
    },
  ],
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400..800&family=JetBrains+Mono:wght@400..600&display=swap',
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/helyos-labs/docs/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      // Offline, client-side search — no Algolia account required.
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 8,
      },
    ],
  ],

  themeConfig: {
    image: 'img/helyos-logo.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Helyos',
      logo: {
        alt: 'Helyos',
        src: 'img/helyos-mark.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/getting-started/installation',
          label: 'Get Started',
          position: 'left',
        },
        {
          to: '/docs/reference/cli',
          label: 'CLI Reference',
          position: 'left',
        },
        {
          href: 'https://github.com/helyos-labs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Introduction', to: '/docs/introduction/what-is-helyos'},
            {label: 'Getting Started', to: '/docs/getting-started/installation'},
            {label: 'Guides', to: '/docs/guides/deploy-a-service'},
            {label: 'CLI Reference', to: '/docs/reference/cli'},
          ],
        },
        {
          title: 'Repositories',
          items: [
            {label: 'helyos', href: 'https://github.com/helyos-labs/helyos'},
            {label: 'helyosd', href: 'https://github.com/helyos-labs/helyosd'},
            {label: 'helyos-cli', href: 'https://github.com/helyos-labs/helyos-cli'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub Organization', href: 'https://github.com/helyos-labs'},
            {
              label: 'License (Apache-2.0)',
              href: 'https://github.com/helyos-labs/helyos/blob/main/LICENSE',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Helyos. Built with Docusaurus.`,
    },
    prism: {
      theme: codeThemeLight,
      darkTheme: codeThemeDark,
      additionalLanguages: ['bash', 'yaml', 'toml', 'rust', 'json', 'docker', 'nginx'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
