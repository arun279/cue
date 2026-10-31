import { notifyManager, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "@/core/runtime/query-cache";

export function createAppQueryClient(): QueryClient {
  notifyManager.setScheduler(queueMicrotask);
  return createQueryClient();
}
