import { useCallback, useEffect, useRef, useState } from "react";
import { createCueRuntime, type RuntimeDeps } from "./create-runtime";
import type { CueRuntime } from "./runtime";
import { sessionTeardown } from "./session";

/** Everything the runtime needs except the token, which boot reads for itself. */
export type RuntimeBootDeps = Omit<RuntimeDeps, "token">;

export interface RuntimeBootState {
  /** Null until the runtime is built; the app paints its loading state meanwhile. */
  readonly runtime: CueRuntime | null;
  /** A boot rejection. Must reach a visible retry rather than a stuck spinner. */
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * Build the authenticated runtime once the session is connected: read the
 * persisted token, restore the durable write-queue and replay it, then register
 * the live teardown so a disconnect can flush and clear through it.
 *
 * The three states are returned rather than rendered, because the loading, failed
 * and ready surfaces are each app's own; what must not be lost in that split is
 * that a failed startup reconcile reaches a retry the user can press.
 */
export function useRuntimeBoot(deps: RuntimeBootDeps): RuntimeBootState {
  const [runtime, setRuntime] = useState<CueRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const {
    tokenStore,
    kv,
    redirectUri,
    clientId,
    apiBaseUrl,
    endSession,
    clearPersistedCaches,
    clearLocalPreferences,
  } = deps;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // No runtime is mounted anymore: a disconnect from here on has nothing to
      // flush/clear through, so drop the registered teardown.
      sessionTeardown.run = () => Promise.resolve();
    };
  }, []);

  const boot = useCallback(() => {
    setFailed(false);
    void (async () => {
      try {
        const token = await tokenStore.read();
        if (token === null) return;
        const built = await createCueRuntime({
          token,
          tokenStore,
          kv,
          redirectUri,
          clientId,
          apiBaseUrl,
          endSession,
          clearPersistedCaches,
          clearLocalPreferences,
        });
        if (alive.current) {
          // Hand disconnect a live teardown: flush pending writes + clear this
          // device's caches through the runtime before the token is revoked.
          sessionTeardown.run = (options) => built.endLocalSession(options);
          setRuntime(built);
        }
      } catch {
        // A boot rejection must never leave the app stuck on the loading spinner;
        // surface a retryable error instead.
        if (alive.current) setFailed(true);
      }
    })();
    // The members, not `deps`: the caller builds that object inline on every
    // render, so depending on it would re-boot the runtime on every render.
  }, [
    tokenStore,
    kv,
    redirectUri,
    clientId,
    apiBaseUrl,
    endSession,
    clearPersistedCaches,
    clearLocalPreferences,
  ]);

  useEffect(() => {
    boot();
  }, [boot]);

  return { runtime, failed, retry: boot };
}
