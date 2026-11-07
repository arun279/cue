import { useCallback, useEffect, useState } from "react";
import { createCueRuntime, type RuntimeDeps } from "../runtime/create-runtime";
import type { CueRuntime } from "../runtime/runtime";
import { useStartFailure } from "../stores/start-failure-store";

export type RuntimeBootDeps = Omit<RuntimeDeps, "token">;

export interface RuntimeBootState {
  readonly runtime: CueRuntime | null;
  readonly failure: string | null;
  readonly booting: boolean;
  readonly retry: () => void;
}

export function useRuntimeBoot(deps: RuntimeBootDeps): RuntimeBootState {
  const [runtime, setRuntime] = useState<CueRuntime | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
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

  const boot = useCallback(() => {
    setBooting(true);
    void (async () => {
      try {
        const token = await tokenStore.read();
        if (token === null) throw new Error("No stored token to boot with");
        setRuntime(
          await createCueRuntime({
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
          }),
        );
      } catch (error) {
        const detail = String(error);
        useStartFailure.setState({ failure: { at: Date.now(), detail } });
        setFailure(detail);
      } finally {
        setBooting(false);
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

  return { runtime, failure, booting, retry: boot };
}
