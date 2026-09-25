import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../ui/Button";
import { TEST_IDS } from "../../ui/test-ids";
import { useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { Section } from "./Rows";

const ACCOUNT_KEYS = new Set(["library", "movie-library", "history", "watchlist"]);

export function syncedPhrase(syncedAt: number, now: number): string {
  if (syncedAt === 0) return "Not synced yet";
  const minutes = Math.max(0, Math.floor((now - syncedAt) / 60_000));
  if (minutes === 0) return "Last synced just now";
  if (minutes < 60) return `Last synced ${minutes} min ago`;
  if (minutes < 1440) return `Last synced ${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `Last synced ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function DataSection(): ReactElement {
  const runtime = useRuntime();
  const cache = useQueryClient().getQueryCache();
  const sync = useSyncNow();
  const colors = useColors();
  const [now, setNow] = useState(Date.now);
  const subscribe = useCallback((notify: () => void) => cache.subscribe(notify), [cache]);
  const syncedAt = useSyncExternalStore(subscribe, () =>
    Math.max(
      0,
      ...cache
        .getAll()
        .filter(
          (query) =>
            ACCOUNT_KEYS.has(String(query.queryKey[0])) ||
            (query.queryKey[0] === "users" && query.queryKey[2] === "stats"),
        )
        .map((query) => query.state.dataUpdatedAt),
    ),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Section title="Data">
      <CueText testID={TEST_IDS.settingsSyncStatus} variant="meta" style={{ color: colors.muted }}>
        {syncedPhrase(syncedAt, now)} · {runtime.pendingWrites()} pending
      </CueText>
      <Button
        label={sync.syncing ? "Syncing…" : "Sync now"}
        variant="link"
        disabled={sync.syncing}
        testID={TEST_IDS.settingsSync}
        onPress={() => void sync.run()}
      />
    </Section>
  );
}
