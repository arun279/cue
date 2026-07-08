import type { NavDestination } from "@ui/app-shell/nav";
import { NavGlyph } from "@ui/components/NavGlyph";
import type { ReactElement } from "react";

const PATHS: Record<NavDestination["icon"], string> = {
  "up-next": "M8 5v14l11-7z",
  calendar:
    "M7 2v3m10-3v3M3 8h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  library: "M4 4h16v12H4zM2 20h20M9 20v-4m6 4v-4",
};

export function NavIcon({ icon }: { icon: NavDestination["icon"] }): ReactElement {
  return (
    <NavGlyph>
      <path d={PATHS[icon]} />
    </NavGlyph>
  );
}
