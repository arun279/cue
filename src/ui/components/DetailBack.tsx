import { useCanGoBack, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * A history-aware "back" affordance for detail screens. When there is in-app
 * history to pop, it renders a button that retraces the real entry point (arriving
 * from Up Next / Search / Calendar / the Library Movies tab returns you there, not
 * to a hardcoded parent). On a fresh/direct load with no history — a deep link or
 * the native app's cold start, which has no browser back chrome — it falls back to
 * a caller-supplied Link so the screen is never a dead end.
 *
 * The fallback owns its own `data-testid`/`className`; the button mirrors them so
 * one selector finds either branch.
 */
export function DetailBack({
  testId,
  label,
  fallback,
}: {
  readonly testId: string;
  /** Visible + accessible label for the history-pop button, e.g. "‹ Back". */
  readonly label: string;
  /** Rendered instead when there is no in-app history to return to. */
  readonly fallback: ReactNode;
}): ReactNode {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  if (!canGoBack) return fallback;

  return (
    <button
      type="button"
      className="detail-back"
      data-testid={testId}
      onClick={() => router.history.back()}
    >
      {label}
    </button>
  );
}
