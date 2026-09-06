import { ToggleGroup } from "radix-ui";
import type { ReactElement } from "react";

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly testId?: string;
}

interface SegmentedControlProps<T extends string> {
  /** 2-3 segments; exactly one is always selected. */
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  onChange(value: T): void;
  readonly ariaLabel: string;
  readonly testId?: string;
}

/**
 * The generic 2-3 way segment switch (Shows|Movies, History type, Theme):
 * a 36px elevated track whose active segment lifts to the surface color, each
 * segment a 44px hit. Exactly one segment is always on.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: SegmentedControlProps<T>): ReactElement {
  return (
    <ToggleGroup.Root
      type="single"
      className="segments"
      value={value}
      onValueChange={(next) => {
        // Radix reports a re-tap of the active segment as ""; one segment is
        // always selected, so ignore it.
        const picked = options.find((option) => option.value === next);
        if (picked !== undefined) onChange(picked.value);
      }}
      aria-label={ariaLabel}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          className="segments__item"
          value={option.value}
          {...(option.testId === undefined ? {} : { "data-testid": option.testId })}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
