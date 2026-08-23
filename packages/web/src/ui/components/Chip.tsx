import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

interface ChipProps {
  /** `status` = Library status chips (label + count); `filter` = the smaller
   * History filters; `month-jump` = label + chevron opening the month sheet. */
  readonly variant?: "status" | "filter" | "month-jump";
  readonly label: string;
  /** Tabular trailing count (status/filter chips keep counts always visible). */
  readonly count?: number;
  readonly selected?: boolean;
  readonly testId?: string;
  onPress?(): void;
}

/**
 * The pill control: 32px visual (28 for filters) in a 44px hit target.
 * Active = amber fill with accent ink; inactive = elevated with quiet ink.
 * Selection is aria-pressed, never color alone (the fill and ink flip together).
 */
export function Chip({
  variant = "status",
  label,
  count,
  selected,
  testId,
  onPress,
}: ChipProps): ReactElement {
  return (
    <button
      type="button"
      className="chip"
      data-variant={variant}
      data-selected={selected === true || undefined}
      {...(selected === undefined ? {} : { "aria-pressed": selected })}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      onClick={onPress}
    >
      {label}
      {count !== undefined && <span className="chip__count">{count}</span>}
      {variant === "month-jump" && <ChevronDown aria-hidden="true" />}
    </button>
  );
}
