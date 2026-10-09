import { useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching } from "@tanstack/react-query";
import {
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";

const QUEUE_SAMPLE_MS = 1000;

const listeners = new Set<() => void>();
let stamp: string | null = null;

function appIdleTiming(): string {
  const now = performance.now();
  const startTime = performance.rnStartupTiming?.startTime;
  return `Returning-user app idle: ${(now - (startTime ?? now)).toFixed(1)} ms${startTime == null ? " (performance.now fallback)" : ""}`;
}

export function useAppIdleStamp(hasData: boolean): void {
  useLayoutEffect(() => {
    if (!hasData || stamp !== null) return;
    stamp = appIdleTiming();
    for (const listener of listeners) listener();
  }, [hasData]);
}

export function resetAppIdleStamp(): void {
  stamp = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function AppIdle(): ReactElement | null {
  const fetching = useIsFetching();
  const inFlight = useSyncActivity((state) => state.pending);
  const checked = useSyncActivity((state) => state.checked);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;
  const timing = useSyncExternalStore(subscribe, () => stamp);

  const [, setSample] = useState(0);
  const hasDurable = durable > 0;
  useEffect(() => {
    if (!hasDurable) return;
    const timer = setInterval(() => setSample((tick) => tick + 1), QUEUE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [hasDurable]);

  if (!checked || fetching > 0 || inFlight > 0 || hasDurable) return null;
  return (
    <>
      <Marker testID={HARNESS_IDS.appIdle} />
      {timing === null ? null : (
        <Marker accessibilityLabel={timing} testID={HARNESS_IDS.appIdleTiming} />
      )}
    </>
  );
}
