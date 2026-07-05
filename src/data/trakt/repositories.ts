import type { ShowIds } from "@domain/model/ids";
import {
  diffActivities,
  type InvalidationTarget,
  type LastActivities,
} from "@domain/sync-activities";
import type { TraktClient, TraktFailure, TraktResult } from "./client";
import { getHidden, getLastActivities, type ItemSelection, itemsBody } from "./endpoints";
import type { HiddenItem } from "./schemas";

const HIDDEN = "/users/hidden/progress_watched";
const HIDDEN_REMOVE = "/users/hidden/progress_watched/remove";

/**
 * Hidden items are their own cached source: the client-side exclusion
 * that drives the Stopped bucket and filters Up Next / calendar / search. Kept a
 * distinct repository — never folded into `watched` — because Trakt does not
 * drop hidden ids from those reads.
 */
export interface HiddenRepository {
  list(): Promise<TraktResult<HiddenItem[]>>;
  hide(shows: readonly ShowIds[]): Promise<TraktResult<unknown>>;
  unhide(shows: readonly ShowIds[]): Promise<TraktResult<unknown>>;
}

export function createHiddenRepository(client: TraktClient): HiddenRepository {
  const body = (shows: readonly ShowIds[]): ItemSelection => ({ shows });
  return {
    list: () => getHidden(client),
    hide: (shows) => client.post(HIDDEN, itemsBody(body(shows))),
    unhide: (shows) => client.post(HIDDEN_REMOVE, itemsBody(body(shows))),
  };
}

type ActivitiesPoll =
  | {
      readonly ok: true;
      readonly activities: LastActivities;
      readonly targets: InvalidationTarget[];
    }
  | { readonly ok: false; readonly error: TraktFailure };

/**
 * `/sync/last_activities` reconciler: the ONLY invalidator of the
 * `staleTime: Infinity` library sections, so its diff must be exact. Poll,
 * diff the fresh timestamps against the caller's stored copy, and return both
 * the fresh activities (to store) and the precise keys to invalidate.
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
