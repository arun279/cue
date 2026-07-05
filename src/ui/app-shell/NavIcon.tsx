import type { NavDestination } from "@ui/app-shell/nav";
import type { ReactElement } from "react";

const PATHS: Record<NavDestination["icon"], string> = {
  "up-next": "M8 5v14l11-7z",
  upcoming:
    "M7 2v3m10-3v3M3 8h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  "my-shows": "M4 4h16v12H4zM2 20h20M9 20v-4m6 4v-4",
  discover: "M12 2 9.2 9.2 2 12l7.2 2.8L12 22l2.8-7.2L22 12l-7.2-2.8z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};

export function NavIcon({ icon }: { icon: NavDestination["icon"] }): ReactElement {
  return (
    <svg
      className="nav__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[icon]} />
    </svg>
  );
}
