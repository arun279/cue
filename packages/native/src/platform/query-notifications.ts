import { notifyManager } from "@tanstack/react-query";

export function deliverQueryUpdatesInMicrotasks(): void {
  notifyManager.setScheduler(queueMicrotask);
}
