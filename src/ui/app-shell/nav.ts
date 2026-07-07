/**
 * The three bottom-nav / sidebar destinations. These collapse the old
 * five-tab bar to exactly three so the tonight loop stays one glance wide (Rams
 * #10 — as little design as possible; the sanctioned divergence from the earlier
 * append-only five-destination rule). Search moved to a persistent header
 * affordance and Profile to a corner/account control — both reachable from
 * anywhere without spending a primary tab slot.
 */
export interface NavDestination {
  readonly path: string;
  readonly label: string;
  readonly icon: "up-next" | "calendar" | "library";
}

const navDestinations: readonly NavDestination[] = [
  { path: "/", label: "Up Next", icon: "up-next" },
  { path: "/calendar", label: "Calendar", icon: "calendar" },
  { path: "/library", label: "Library", icon: "library" },
];

/**
 * The primary destinations for the enabled media. Up Next and Calendar
 * are TV-centric by construction, so a movies-only app sheds both and Library
 * becomes the single primary tab (Search + Profile stay reachable as the header /
 * sidebar affordances). With TV present — the default and the TV-only case — all
 * three stand unchanged. The flag only ever prunes; it never appends.
 */
export function navFor({
  showsEnabled,
}: {
  readonly showsEnabled: boolean;
}): readonly NavDestination[] {
  if (showsEnabled) return navDestinations;
  return [{ path: "/library", label: "Library", icon: "library" }];
}
