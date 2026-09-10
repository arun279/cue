import { useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching } from "@tanstack/react-query";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Marker } from "./Marker";
import { TEST_IDS } from "./test-ids";

/**
 * Re-sample cadence while the durable queue holds ops: the op-log has no
 * subscription surface, and a background flush drains it without any in-flight
 * transition to re-render on.
 */
const QUEUE_SAMPLE_MS = 1000;

function startupTiming(): string {
  const now = performance.now();
  const startTime = performance.rnStartupTiming?.startTime;
  return `Startup timing: ${(now - (startTime ?? now)).toFixed(1)} ms${startTime == null ? " (performance.now fallback)" : ""}`;
}

/** Pending durable writes count as busy even when no flush is in flight. */
export function AppIdle(): ReactElement | null {
  const fetching = useIsFetching();
  const inFlight = useSyncActivity((state) => state.pending);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;
  const timing = useRef<string>(undefined);

  const [, setSample] = useState(0);
  const hasDurable = durable > 0;
  useEffect(() => {
    if (!hasDurable) return;
    const timer = setInterval(() => setSample((tick) => tick + 1), QUEUE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [hasDurable]);

  if (fetching > 0 || inFlight > 0 || hasDurable) return null;
  timing.current ??= startupTiming();
  return (
    <>
      <Marker testID={TEST_IDS.appIdle} />
      <Marker accessibilityLabel={timing.current} testID={TEST_IDS.startupTiming} />
    </>
  );
}
