import { useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching } from "@tanstack/react-query";
import { type ReactElement, useEffect, useState } from "react";
import { HARNESS_IDS } from "./harness-ids";
import { Marker } from "./Marker";

const QUEUE_SAMPLE_MS = 1000;

export function AppIdle(): ReactElement | null {
  const fetching = useIsFetching();
  const inFlight = useSyncActivity((state) => state.pending);
  const checked = useSyncActivity((state) => state.checked);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;
  const [ready, setReady] = useState(false);
  const idle = checked && fetching === 0 && inFlight === 0 && durable === 0;

  useEffect(() => {
    if (idle) setReady(true);
  }, [idle]);

  const [, setSample] = useState(0);
  const hasDurable = durable > 0;
  useEffect(() => {
    if (!hasDurable) return;
    const timer = setInterval(() => setSample((tick) => tick + 1), QUEUE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [hasDurable]);

  return (
    <>
      {idle ? <Marker testID={HARNESS_IDS.appIdle} /> : null}
      {ready ? <Marker testID={HARNESS_IDS.appReady} /> : null}
    </>
  );
}
