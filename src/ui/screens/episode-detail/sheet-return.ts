import type { RefObject } from "react";
import { createContext } from "react";

/**
 * How the episode sheet should close. The show page beneath (the sheet route's
 * layout parent) flips the ref to `true` once it has rendered WITHOUT the sheet:
 * from then on the sheet arrived by an in-app push from that page, so closing is
 * `history.back()` (restoring scroll and the back stack). While `false` — a cold
 * deep link, or an arrival straight onto the episode URL from another screen —
 * closing replaces the URL with the show page instead, so Back still retraces
 * the real entry point.
 */
export const SheetReturnContext = createContext<RefObject<boolean> | null>(null);
