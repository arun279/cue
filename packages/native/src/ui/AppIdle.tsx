import { useOptionalRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useIsFetching } from "@tanstack/react-query";
import { type ReactElement, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TEST_IDS } from "./test-ids";

/**
 * Re-sample cadence while the durable queue holds ops: the op-log has no
 * subscription surface, and a background flush drains it without any in-flight
 * transition to re-render on.
 */
const QUEUE_SAMPLE_MS = 1000;

/**
 * The idle marker, and the reason the end-to-end lane records a behavior rather
 * than a race. It is present only when no read is in flight and nothing is
 * waiting to be written, which is the native equivalent of a network-idle wait:
 * pending is the higher of the in-flight flush count and the durable queue
 * depth, because a mark deferred offline sits in the op-log with nothing in
 * flight and is still pending.
 *
 * A point in the corner rather than a zero-sized view, so the hierarchy dump the
 * runner reads has something with bounds to find, and it neither takes touches
 * nor speaks.
 */
export function AppIdle(): ReactElement | null {
  const fetching = useIsFetching();
  const inFlight = useSyncActivity((state) => state.pending);
  const durable = useOptionalRuntime()?.pendingWrites() ?? 0;

  const [, setSample] = useState(0);
  const hasDurable = durable > 0;
  useEffect(() => {
    if (!hasDurable) return;
    const timer = setInterval(() => setSample((tick) => tick + 1), QUEUE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [hasDurable]);

  if (fetching > 0 || inFlight > 0 || hasDurable) return null;
  return <View testID={TEST_IDS.appIdle} pointerEvents="none" style={styles.marker} />;
}

const styles = StyleSheet.create({
  marker: { position: "absolute", left: 0, bottom: 0, width: 1, height: 1 },
});
