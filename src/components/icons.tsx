import type {ReactNode, SVGProps} from 'react';

/**
 * Minimal line-icon set (24px grid, stroke = currentColor) used across the site
 * in place of emoji. Stroke-based, cohesive, and themable.
 */
function Base({children, ...props}: SVGProps<SVGSVGElement> & {children: ReactNode}) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}>
      {children}
    </svg>
  );
}

/** Deploy — a bolt for speed. */
export function IconDeploy(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M13 2 4.5 13.2a.6.6 0 0 0 .49.95H10.5L11 22l8.5-11.2a.6.6 0 0 0-.49-.95H13.5z" />
    </Base>
  );
}

/** Secure — shield with a check. */
export function IconSecure(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 22s7.5-3.6 7.5-9.4V5.2L12 2.4 4.5 5.2v7.4C4.5 18.4 12 22 12 22z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  );
}

/** Remote control — a compass (echoes the Helyos mark). */
export function IconCompass(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z" />
    </Base>
  );
}

/** Batteries included — stacked layers (everything bundled in). */
export function IconBundle(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m12 2.5 9.2 5-9.2 5-9.2-5z" />
      <path d="m3 12 9 4.9 9-4.9" />
      <path d="m3 16.4 9 4.9 9-4.9" />
    </Base>
  );
}

/** Clustering — a small node graph. */
export function IconCluster(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="19" r="2.4" />
      <circle cx="19" cy="19" r="2.4" />
      <path d="M11 7 6.4 16.6M13 7l4.6 9.6M7.4 19h9.2" />
    </Base>
  );
}

/** Runtimes — a container box. */
export function IconRuntime(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M21 8.1a2 2 0 0 0-1-1.74l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8.1v7.8a2 2 0 0 0 1 1.74l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.74z" />
      <path d="M3.3 7.2 12 12.2l8.7-5" />
      <path d="M12 22.1V12.2" />
    </Base>
  );
}

/** Arrow — used in CTAs and "next" links. */
export function IconArrow(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Base>
  );
}

/** Install — a download into a tray. */
export function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </Base>
  );
}

/** Deploy from the CLI — a terminal prompt. */
export function IconTerminal(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="2.5" y="4" width="19" height="16" rx="2.2" />
      <path d="m6.5 9 3 3-3 3" />
      <path d="M12.5 15h5" />
    </Base>
  );
}

/** Operate — a health/activity pulse. */
export function IconActivity(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3 12h4l2.5-6 5 12L17 12h4" />
    </Base>
  );
}
