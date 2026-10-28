import { useCallback, useEffect, useRef, useState } from "react";
import { createCueRuntime, type RuntimeDeps } from "../runtime/create-runtime";
import type { CueRuntime } from "../runtime/runtime";
import { sessionTeardown } from "../runtime/session";
import { useStartFailure } from "../stores/start-failure-store";

export type RuntimeBootDeps = Omit<RuntimeDeps, "token">;

export interface RuntimeBootState {
  readonly runtime: CueRuntime | null;
  readonly failure: string | null;
  readonly retry: () => void;
}

export function useRuntimeBoot(deps: RuntimeBootDeps): RuntimeBootState {
  const [runtime, setRuntime] = useState<CueRuntime | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  const {
    newId,
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
      sessionTeardown.run = () => Promise.resolve();
    };
  }, []);

  const boot = useCallback(() => {
    setFailure(null);
    void (async () => {
      try {
        const token = await tokenStore.read();
        if (token === null) throw new Error("No stored token to boot with");
        const built = await createCueRuntime({
          newId,
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
          sessionTeardown.run = (options) => built.endLocalSession(options);
          setRuntime(built);
        }
      } catch (error) {
        const detail = String(error);
        useStartFailure.setState({ failure: { at: Date.now(), detail } });
        if (alive.current) setFailure(detail);
      }
    })();
  }, [
    tokenStore,
    kv,
    redirectUri,
    clientId,
    apiBaseUrl,
    endSession,
    clearPersistedCaches,
    clearLocalPreferences,
    newId,
  ]);

  useEffect(() => {
    boot();
  }, [boot]);

  return { runtime, failure, retry: boot };
}
