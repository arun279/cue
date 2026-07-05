/**
 * The fixed five navigation destinations. This is
 * an append-only surface: later work fills in the screens behind these
 * paths but never reorder or rewrite the list. Search is a header affordance,
 * not a destination.
 */
export interface NavDestination {
  readonly path: string;
  readonly label: string;
  readonly icon: "up-next" | "upcoming" | "my-shows" | "discover" | "profile";
}

export const navDestinations: readonly NavDestination[] = [
  { path: "/", label: "Up Next", icon: "up-next" },
  { path: "/upcoming", label: "Upcoming", icon: "upcoming" },
  { path: "/my-shows", label: "My Shows", icon: "my-shows" },
  { path: "/discover", label: "Discover", icon: "discover" },
  { path: "/profile", label: "Profile", icon: "profile" },
];
