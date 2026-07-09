import type { NavDestination } from "@ui/app-shell/nav";
import { NavGlyph } from "@ui/components/NavGlyph";
import type { ReactElement } from "react";

/** Each destination's inner glyph, drawn inside the shared 24×24 stroked NavGlyph.
 * History is a clock-with-rewind (the reversal surface); Discover is a magnifier
 * inheriting the search vocabulary its route still serves. */
const GLYPHS: Record<NavDestination["icon"], ReactElement> = {
  "up-next": <path d="M8 5v14l11-7z" />,
  library: <path d="M4 4h16v12H4zM2 20h20M9 20v-4m6 4v-4" />,
  history: (
    <>
      <path d="M3.05 11a9 9 0 1 1 .5 4M3 11V6m0 5h5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  discover: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
};

export function NavIcon({ icon }: { icon: NavDestination["icon"] }): ReactElement {
  return <NavGlyph>{GLYPHS[icon]}</NavGlyph>;
}
