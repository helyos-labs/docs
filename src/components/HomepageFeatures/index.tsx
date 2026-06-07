import type {ComponentType, ReactNode, SVGProps} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import {
  IconDeploy,
  IconSecure,
  IconCompass,
  IconBundle,
  IconCluster,
  IconRuntime,
  IconArrow,
} from '@site/src/components/icons';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  description: ReactNode;
  to: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Deploy in seconds',
    Icon: IconDeploy,
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
    Icon: IconSecure,
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
    Icon: IconCompass,
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
    Icon: IconBundle,
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
    Icon: IconCluster,
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
    Icon: IconRuntime,
    to: '/docs/introduction/architecture',
    description: (
      <>
        Both runtimes are auto-detected at startup. State lives in an embedded
        SQLite database — there is no external datastore to operate.
      </>
    ),
  },
];

function Feature({title, Icon, description, to}: FeatureItem) {
  return (
    <div className={clsx('col col--4', styles.cardCol)}>
      <Link to={to} className={styles.cardLink} aria-label={title}>
        <div className={styles.card}>
          <span className={styles.cardIcon}>
            <Icon width={22} height={22} />
          </span>
          <Heading as="h3" className={styles.cardTitle}>
            {title}
          </Heading>
          <p className={styles.cardText}>{description}</p>
          <span className={styles.cardMore}>
            Learn more
            <IconArrow width={15} height={15} />
          </span>
        </div>
      </Link>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className="helyos-eyebrow">Why Helyos</span>
          <Heading as="h2" className={styles.sectionTitle}>
            Orchestration without the operations tax
          </Heading>
          <p className={styles.sectionLede}>
            Everything you need to run containers in production — and nothing you
            have to assemble yourself.
          </p>
        </div>
        <div className="row">
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
