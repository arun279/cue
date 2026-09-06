import type { Network } from "@cue/core/ports/network";

/** `Network` over `navigator.onLine` and the two window events that move it. */
export const webNetwork: Network = {
  isOnline: () => navigator.onLine,
  subscribe(listener) {
    globalThis.addEventListener("online", listener);
    globalThis.addEventListener("offline", listener);
    return () => {
      globalThis.removeEventListener("online", listener);
      globalThis.removeEventListener("offline", listener);
    };
  },
};
