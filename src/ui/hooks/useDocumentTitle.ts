import { useEffect } from "react";

/**
 * Set a truthful, per-screen document title (WCAG 2.4.2 Page Titled). The static
 * `index.html` title is "Cue"; every routed screen names itself so browser tabs,
 * history, and screen-reader page identification can tell the screens apart.
 * `null` skips stamping: a parent screen yields the title to a presented child
 * (the episode sheet) so its own late-resolving reads can't clobber it.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}
