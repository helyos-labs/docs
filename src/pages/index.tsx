import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

const quickstart = `# Install both binaries (daemon + CLI)
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh

# Start the daemon — it writes a local CLI context on first run
helyosd

# Deploy a service from a simple YAML spec
helyos deploy app.yaml
helyos status`;

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  const logo = useBaseUrl('/img/helyos-logo.png');
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroText}>
          <img src={logo} alt="Helyos" className={styles.heroLogo} />
          <Heading as="h1" className={styles.heroTitle}>
            Container orchestration
            <br />
            for the rest of us
          </Heading>
          <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
          <p className={styles.heroNote}>
            Two binaries. Zero external dependencies. Written in Rust.
          </p>
          <div className={styles.heroButtons}>
            <Link
              className="button button--primary button--lg"
              to="/docs/getting-started/installation">
              Get Started
            </Link>
            <Link
              className="button button--secondary button--lg"
              to="/docs/introduction/what-is-helyos">
              Why Helyos?
            </Link>
          </div>
        </div>
        <div className={styles.heroCode}>
          <CodeBlock language="bash" title="Quickstart">
            {quickstart}
          </CodeBlock>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — simple container orchestration`}
      description="Helyos is a simple, single-daemon container orchestration platform written in Rust — 80% of Kubernetes use-cases with 20% of the complexity.">
      <Hero />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
