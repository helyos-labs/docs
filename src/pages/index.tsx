import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import {
  IconArrow,
  IconDownload,
  IconTerminal,
  IconActivity,
} from '@site/src/components/icons';

import styles from './index.module.css';

const quickstart = `# Install both binaries (daemon + CLI)
curl -sSfL https://raw.githubusercontent.com/helyos-labs/helyos/main/install.sh | sh

# Deploy a service from a simple YAML spec
helyos deploy app.yaml
helyos status`;

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroText}>
          <span className={styles.heroBadge}>
            <span className={styles.heroDot} />
            Written in Rust · two binaries · zero external deps
          </span>
          <Heading as="h1" className={styles.heroTitle}>
            Container orchestration
            <br />
            for the rest of us
          </Heading>
          <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
          <p className={styles.heroNote}>
            One daemon, one CLI. Deploy, scale, route, and observe your services
            without an afternoon of YAML and a control plane to babysit.
          </p>
          <div className={styles.heroButtons}>
            <Link
              className="button button--primary button--lg"
              to="/docs/getting-started/installation">
              Get started
              <IconArrow width={17} height={17} />
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

type Step = {
  Icon: typeof IconDownload;
  title: string;
  description: ReactNode;
};

const STEPS: Step[] = [
  {
    Icon: IconDownload,
    title: 'Install',
    description: (
      <>
        One script drops the <code>helyosd</code> daemon and the{' '}
        <code>helyos</code> CLI onto any Linux host. No cluster bootstrap.
      </>
    ),
  },
  {
    Icon: IconTerminal,
    title: 'Deploy',
    description: (
      <>
        Write a short YAML spec and run <code>helyos deploy app.yaml</code>. The
        daemon pulls images, places pods, and wires up DNS.
      </>
    ),
  },
  {
    Icon: IconActivity,
    title: 'Operate',
    description: (
      <>
        Scale, inspect, and route from your terminal — locally, or over a pinned
        remote with <code>helyos login</code>.
      </>
    ),
  },
];

function HowItWorks() {
  return (
    <section className={styles.how}>
      <div className="container">
        <div className={styles.howHead}>
          <span className={styles.eyebrow}>How it works</span>
          <Heading as="h2" className={styles.howTitle}>
            From zero to running in three steps
          </Heading>
        </div>
        <ol className={styles.steps}>
          {STEPS.map(({Icon, title, description}, idx) => (
            <li key={title} className={styles.step}>
              <span className={styles.stepNum}>{String(idx + 1).padStart(2, '0')}</span>
              <span className={styles.stepIcon}>
                <Icon width={20} height={20} />
              </span>
              <Heading as="h3" className={styles.stepTitle}>
                {title}
              </Heading>
              <p className={styles.stepText}>{description}</p>
            </li>
          ))}
        </ol>
        <div className={styles.howCta}>
          <Link to="/docs/introduction/architecture" className={styles.howLink}>
            See how the pieces fit together
            <IconArrow width={16} height={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Documentation`}
      description="Helyos is a simple, single-daemon container orchestration platform written in Rust — 80% of Kubernetes use-cases with 20% of the complexity.">
      <Hero />
      <main>
        <HomepageFeatures />
        <HowItWorks />
      </main>
    </Layout>
  );
}
