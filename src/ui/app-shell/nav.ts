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

export const navDestinations: readonly NavDestination[] = [
  { path: "/", label: "Up Next", icon: "up-next" },
  { path: "/calendar", label: "Calendar", icon: "calendar" },
  { path: "/library", label: "Library", icon: "library" },
];
