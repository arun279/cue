import { useQuery } from "@tanstack/react-query";
import type { UserProfile } from "../data/trakt/user-profile";
import { userProfileQuery } from "../queries/user";
import { useRuntime } from "../runtime/runtime";

/**
 * The Profile identity read: `/users/settings`, once. Identity changes about
 * never, so the persisted entry stays fresh forever and sits deliberately
 * outside the last-activities reconciler. No activity stamp moves when a user
 * renames or re-avatars, and a sign-out clears the cache anyway. Undefined
 * while loading or failed; the identity row keeps its glyph fallback then.
 */
export function useUserProfile(): UserProfile | undefined {
  const runtime = useRuntime();
  const query = useQuery(userProfileQuery(runtime));
  return query.data;
}
