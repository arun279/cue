import { createCueRuntime } from "@app/runtime/create-runtime";
import type { CredsStore } from "@platform/creds-store";
import type { KeyValueStore } from "@platform/kv";
import type { TokenStore } from "@platform/token-store";
import { type CueRuntime, RuntimeProvider } from "@ui/runtime/runtime";
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export interface RuntimeBootProps {
  readonly tokenStore: TokenStore;
  readonly credsStore: CredsStore;
  readonly kv: KeyValueStore;
  readonly children: ReactNode;
}

/**
 * Instantiate the authenticated runtime once the session is connected and hand
 * it to `@ui` through context (platform/data wiring lives here,
 * not in the UI). Boot reads the persisted token + creds, restores the durable
 * write-queue, and replays it; the children mount only once it is ready.
 */
export function RuntimeBoot({
  tokenStore,
  credsStore,
  kv,
  children,
}: RuntimeBootProps): ReactElement {
  const [runtime, setRuntime] = useState<CueRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const boot = useCallback(() => {
    setFailed(false);
    void (async () => {
      try {
        const [token, creds] = await Promise.all([tokenStore.read(), credsStore.read()]);
        if (token === null || creds === null) return;
        const built = await createCueRuntime({ token, creds, kv });
        if (alive.current) setRuntime(built);
      } catch {
        // A boot rejection must never leave the app stuck on the loading spinner;
        // surface a retryable error instead.
        if (alive.current) setFailed(true);
      }
    })();
  }, [tokenStore, credsStore, kv]);

  useEffect(() => {
    boot();
  }, [boot]);

  if (failed && runtime === null) {
    return (
      <main className="onboarding" data-testid="runtime-error">
        <p className="onboarding__lead" role="alert">
          Couldn't start Cue.
        </p>
        <button type="button" className="button" data-testid="runtime-error-retry" onClick={boot}>
          Retry
        </button>
      </main>
    );
  }

  if (runtime === null) {
    return (
      <main className="onboarding" data-testid="runtime-loading">
        <p className="onboarding__lead" role="status">
          Loading your queue…
        </p>
      </main>
    );
  }

  return <RuntimeProvider value={runtime}>{children}</RuntimeProvider>;
}
