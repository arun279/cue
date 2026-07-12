import { Calendar, CirclePlay, LibraryBig, type LucideIcon, Search } from "lucide-react";

/**
 * The four tab destinations: what's next, what you track, what's coming, what
 * to add. History lives under Profile and Profile/Settings behind the header
 * avatar; neither is a daily job, so neither gets a tab.
 */
export interface NavDestination {
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly testId: string;
}

const tabs: readonly NavDestination[] = [
  { path: "/", label: "Up Next", icon: CirclePlay, testId: "tab-up-next" },
  { path: "/library", label: "Library", icon: LibraryBig, testId: "tab-library" },
  { path: "/calendar", label: "Calendar", icon: Calendar, testId: "tab-calendar" },
  { path: "/search", label: "Search", icon: Search, testId: "tab-search" },
];

/**
 * The tab set for the enabled media. Up Next and Calendar are episodic by
 * construction, so a movies-only app sheds both and lands on Library / Search.
 * The flag only ever prunes; it never appends.
 */
export function navFor({
  showsEnabled,
}: {
  readonly showsEnabled: boolean;
}): readonly NavDestination[] {
  return showsEnabled ? tabs : tabs.filter(({ path }) => path === "/library" || path === "/search");
}
