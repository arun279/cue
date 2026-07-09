/**
 * The primary bottom-nav / sidebar destinations — a 1:1 map of Cue's four jobs
 *: record+next, review+reverse, manage library, discover.
 * Calendar is deliberately NOT here — it demoted from a top slot to an "Upcoming"
 * view one tap inside Up Next. Profile + Settings left the bar too, onto a
 * header avatar. The flag only ever prunes the set; it never appends.
 */
export interface NavDestination {
  readonly path: string;
  readonly label: string;
  readonly icon: "up-next" | "library" | "history" | "discover";
}

/** Up Next is episodic by construction, so it is the one tab a movies-only app
 * sheds. Library / History / Discover all carry both media, so they stand for
 * every user. */
const upNext: NavDestination = { path: "/", label: "Up Next", icon: "up-next" };
const crossMedia: readonly NavDestination[] = [
  { path: "/library", label: "Library", icon: "library" },
  { path: "/history", label: "History", icon: "history" },
  // Discover reuses the /search route + screen; only the label and icon changed.
  { path: "/search", label: "Discover", icon: "discover" },
];

/**
 * The primary destinations for the enabled media. With TV present — the
 * default and the TV-only case — all four jobs get a tab. A movies-only app sheds
 * the TV-centric Up Next and lands on Library / History / Discover (a coherent home,
 * never an empty Up Next). The flag only ever prunes; it never appends.
 */
export function navFor({
  showsEnabled,
}: {
  readonly showsEnabled: boolean;
}): readonly NavDestination[] {
  return showsEnabled ? [upNext, ...crossMedia] : crossMedia;
}
