import { createQueryClient } from "@cue/core/runtime/query-cache";
import { notifyManager, type QueryClient } from "@tanstack/react-query";

export function createAppQueryClient(): QueryClient {
  notifyManager.setScheduler(queueMicrotask);
  return createQueryClient();
}
