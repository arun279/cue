import {
  diffActivities,
  type InvalidationTarget,
  type LastActivities,
} from "@domain/sync-activities";
import type { TraktClient, TraktFailure } from "./client";
import { getLastActivities } from "./pooled-endpoints";

type ActivitiesPoll =
  | {
      readonly ok: true;
      readonly activities: LastActivities;
      readonly targets: InvalidationTarget[];
    }
  | { readonly ok: false; readonly error: TraktFailure };

/**
 * `/sync/last_activities` reconciler: the ONLY invalidator of the
 * `staleTime: Infinity` user-state library sections, so its diff must be exact.
 * Poll, diff the fresh timestamps against the caller's stored copy, and return
 * both the fresh activities (to persist as the next baseline) and the precise set
 * of keys to invalidate. Wired by the app runtime's `pollActivities`.
 */
export interface LastActivitiesRepository {
  poll(stored: LastActivities | undefined): Promise<ActivitiesPoll>;
}

export function createLastActivitiesRepository(client: TraktClient): LastActivitiesRepository {
  return {
    poll: async (stored) => {
      const result = await getLastActivities(client);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, activities: result.data, targets: diffActivities(stored, result.data) };
    },
  };
}
