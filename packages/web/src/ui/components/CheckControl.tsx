import type { ReactElement } from "react";

export type CheckState = "unwatched" | "just-marked" | "advancing" | "watched" | "unaired";

interface CheckControlProps {
  readonly state: CheckState;
  /** Outer control box; the visual circle is 8px smaller, the hit slop ≥48. */
  readonly size?: 44 | 48 | 56;
  /**
   * `advance` = queue grammar: after a mark the filled check is a live undo
   * toggle for the undo window, then the row advances. `toggle` = everywhere else:
   * filled means watched, a tap removes the latest play. Purely semantic here
   * (the owner wires the tap); exposed as `data-mode` for tests.
   */
  readonly mode?: "advance" | "toggle";
  /** Full accessible name for the CURRENT action, e.g. "Mark The Wire S1 E5
   * watched" or "Watched. Tap to remove." Ignored for `unaired` (a
   * non-interactive date chip). */
  readonly label: string;
  readonly testId?: string;
  /** Play count; ≥2 renders the ×N badge on the watched disc. */
  readonly plays?: number;
  /** Season-bulk partial state: hollow ring with a center dot. */
  readonly partial?: boolean;
  /** The mark behind an `advancing` row has not reached Trakt yet: a quiet dot,
   * never a spinner and never green. */
  readonly pending?: boolean;
  /** The micro date chip that replaces the control while unaired, e.g. "Jul 16". */
  readonly unairedDate?: string;
  onPress?(): void;
}

/** The check glyph. `pathLength` normalizes the dash math so CSS can stroke-draw
 * the filled layer 1 → 0 while the rest layer stays fully drawn. */
function Glyph({ layer }: { readonly layer: "rest" | "fill" }): ReactElement {
  return (
    <svg
      className={`check__${layer}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="check__glyph"
        d="M5 12.5l4.5 4.5L19 7.5"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The one mark-watched shape everywhere an episode can be marked: a circle with
 * a check, always carrying the glyph ("a check waiting to happen", never bare
 * decoration). Its look is a pure function of watched STATE (green disc = done,
 * quiet ring = waiting), never of the surface it sits on. There is deliberately
 * no spinner: marks are optimistic and instant. `pending` is the one nod to the
 * write queue, a quiet dot rather than a busy state, because the mark is saved
 * either way and there is nothing for the user to wait on.
 */
export function CheckControl({
  state,
  size = 44,
  mode = "toggle",
  label,
  testId = "mark-watched",
  plays,
  partial = false,
  pending = false,
  unairedDate,
  onPress,
}: CheckControlProps): ReactElement {
  if (state === "unaired") {
    return (
      <span className="check-date" data-testid={testId} data-state="unaired">
        {unairedDate}
      </span>
    );
  }
  // `advancing` is the row that has already moved on while Trakt names its next
  // episode: watched, so the switch reads checked, but not green and not armed.
  const filled = state === "just-marked" || state === "watched";
  const advancing = state === "advancing";
  return (
    <button
      type="button"
      className="check"
      role="switch"
      aria-checked={filled || advancing}
      aria-disabled={advancing || undefined}
      aria-label={label}
      data-testid={testId}
      data-state={state}
      data-size={size}
      data-mode={mode}
      {...(partial && !filled ? { "data-partial": "true" } : {})}
      {...(pending ? { "data-pending": "true" } : {})}
      onClick={onPress}
    >
      <span className="check__disc" aria-hidden="true">
        <Glyph layer="rest" />
        <span className="check__fill-disc">
          <Glyph layer="fill" />
        </span>
        {((partial && !filled) || pending) && <span className="check__dot" />}
      </span>
      {filled && plays !== undefined && plays > 1 && (
        <span className="check__plays" aria-hidden="true">
          ×{plays}
        </span>
      )}
    </button>
  );
}
