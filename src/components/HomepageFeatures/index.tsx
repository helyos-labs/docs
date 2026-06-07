import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
  to?: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Deploy in seconds',
    icon: '🚀',
    to: '/docs/guides/deploy-a-service',
    description: (
      <>
        Describe your service in a small YAML spec and ship it with a single
        command. No Helm, no Kustomize, no templating engine.
      </>
    ),
  },
  {
    title: 'Secure by default',
    icon: '🔒',
    to: '/docs/security/security-model',
    description: (
      <>
        An HTTPS API with a self-signed certificate out of the box, multi-user
        bearer tokens, and a hard guardrail against exposing the control plane in
        the clear.
      </>
    ),
  },
  {
    title: 'kubectl-style remote control',
    icon: '🧭',
    to: '/docs/guides/remote-access',
    description: (
      <>
        <code>helyos login</code> pins the daemon&apos;s CA and stores a named
        context, so you can manage one cluster or many from your terminal.
      </>
    ),
  },
  {
    title: 'Batteries included',
    icon: '🌐',
    to: '/docs/guides/routing',
    description: (
      <>
        Built-in service discovery (DNS), a reverse proxy, and automatic
        Let&apos;s Encrypt TLS for your public routes — no extra components to
        install.
      </>
    ),
  },
  {
    title: 'Multi-node clustering',
    icon: '🧩',
    to: '/docs/guides/clustering',
    description: (
      <>
        Join workers with a single token. The scheduler spreads or bin-packs pods
        and automatically reschedules them when a node fails.
      </>
    ),
  },
  {
    title: 'Docker & containerd',
    icon: '⚙️',
    to: '/docs/introduction/architecture',
    description: (
      <>
        Both runtimes are auto-detected at startup. State lives in an embedded
        SQLite database — there is no external datastore to operate.
      </>
    ),
  },
];

function Feature({title, icon, description, to}: FeatureItem) {
  const body = (
    <div className={styles.card}>
      <div className={styles.cardIcon} aria-hidden="true">
        {icon}
      </div>
      <Heading as="h3" className={styles.cardTitle}>
        {title}
      </Heading>
      <p className={styles.cardText}>{description}</p>
    </div>
  );
  return (
    <div className={clsx('col col--4', styles.cardCol)}>
      {to ? (
        <Link to={to} className={styles.cardLink}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
