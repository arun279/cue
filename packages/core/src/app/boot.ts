import { useCallback, useEffect, useRef, useState } from "react";
import type { CueRuntime } from "../runtime/runtime";
import { createCueRuntime, type RuntimeDeps } from "./create-runtime";
import { sessionTeardown } from "./session";

export type RuntimeBootDeps = Omit<RuntimeDeps, "token">;

export interface RuntimeBootState {
  readonly runtime: CueRuntime | null;
  readonly failed: boolean;
  readonly retry: () => void;
}

export function useRuntimeBoot(deps: RuntimeBootDeps): RuntimeBootState {
  const [runtime, setRuntime] = useState<CueRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const {
    newId,
    tokenStore,
    kv,
    redirectUri,
    clientId,
    apiBaseUrl,
    browser,
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
    setFailed(false);
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
          browser,
          endSession,
          clearPersistedCaches,
          clearLocalPreferences,
        });
        if (alive.current) {
          sessionTeardown.run = (options) => built.endLocalSession(options);
          setRuntime(built);
        }
      } catch {
        if (alive.current) setFailed(true);
      }
    })();
  }, [
    tokenStore,
    kv,
    redirectUri,
    clientId,
    apiBaseUrl,
    browser,
    endSession,
    clearPersistedCaches,
    clearLocalPreferences,
    newId,
  ]);

  useEffect(() => {
    boot();
  }, [boot]);

  return { runtime, failed, retry: boot };
}
