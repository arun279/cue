import {
  diffActivities,
  type InvalidationTarget,
  type LastActivities,
} from "../../domain/sync-activities";
import type { TraktClient, TraktFailure } from "./client";
import { getLastActivities } from "./pooled-endpoints";

type ActivitiesPoll =
  | {
      readonly ok: true;
      readonly activities: LastActivities;
      readonly targets: InvalidationTarget[];
    }
  | { readonly ok: false; readonly error: TraktFailure };

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
