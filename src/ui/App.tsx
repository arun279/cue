import { healthCheck } from "@data/health";
import type { ReactElement } from "react";

export interface AppProps {
  /** Injected by the composition root (src/app) — ui never imports src/platform. */
  platform: string;
}

export function App({ platform }: AppProps): ReactElement {
  const health = healthCheck();
  return (
    <main className="shell">
      <h1>Cue</h1>
      <p className="tagline">Your Up Next queue.</p>
      <p data-testid="health">
        status: {health.status} · platform: {platform} · cue: {health.sampleCue}
      </p>
    </main>
  );
}
