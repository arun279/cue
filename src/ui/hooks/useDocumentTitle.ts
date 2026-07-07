import { useEffect } from "react";

/**
 * Set a truthful, per-screen document title (WCAG 2.4.2 Page Titled). The static
 * `index.html` title is "Cue"; every routed screen names itself so browser tabs,
 * history, and screen-reader page identification can tell the screens apart.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
