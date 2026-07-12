import { queryKeys } from "@data/query-keys";
import type { UserProfile } from "@data/trakt/user-profile";
import { useQuery } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

/**
 * The Profile identity read: `/users/settings`, once. Identity changes about
 * never, so the persisted entry stays fresh forever and sits deliberately
 * outside the last-activities reconciler — no activity stamp moves when a user
 * renames or re-avatars, and a sign-out clears the cache anyway. Undefined
 * while loading or failed; the identity row keeps its glyph fallback then.
 */
export function useUserProfile(): UserProfile | undefined {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.userSettings(),
    queryFn: () => runtime.loadUserProfile(),
    staleTime: USER_STATE_STALE_TIME,
  });
  return query.data;
}
