import { useSyncExternalStore } from "react";

function subscribeOnline(onChange: () => void): () => void {
  globalThis.addEventListener("online", onChange);
  globalThis.addEventListener("offline", onChange);
  return () => {
    globalThis.removeEventListener("online", onChange);
    globalThis.removeEventListener("offline", onChange);
  };
}

/** Live `navigator.onLine` as React state (SyncStrip's offline line, Search's offline notice). */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => !navigator.onLine);
}
