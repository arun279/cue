import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Switch } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

/** A labelled settings group: caps section label over a hairline-separated list. */
export function SettingSection({
  label,
  children,
  testId,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactElement {
  return (
    <section
      className="setting-section"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <h2 className="setting-section__label">{label}</h2>
      <div className="setting-section__list">{children}</div>
    </section>
  );
}

function RowText({
  label,
  hint,
}: {
  readonly label: string;
  readonly hint?: string;
}): ReactElement {
  return (
    <span className="setting-row__text">
      <span className="setting-row__label">{label}</span>
      {hint !== undefined && <span className="setting-row__hint">{hint}</span>}
    </span>
  );
}

/** A non-navigating row: label (+ optional hint) with a trailing control. */
export function SettingRow({
  label,
  hint,
  control,
  testId,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly control: ReactNode;
  readonly testId?: string;
}): ReactElement {
  return (
    <div className="setting-row" {...(testId === undefined ? {} : { "data-testid": testId })}>
      <RowText label={label} hint={hint} />
      {control}
    </div>
  );
}

/** A picker row: shows the current value and opens its options sheet. */
export function SettingSelectRow({
  label,
  hint,
  value,
  testId,
  onPress,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly testId?: string;
  onPress(): void;
}): ReactElement {
  return (
    <button
      type="button"
      className="setting-row setting-row--press"
      {...(testId === undefined ? {} : { "data-testid": testId })}
      onClick={onPress}
    >
      <RowText label={label} hint={hint} />
      <span className="setting-row__value">
        {value}
        <ChevronDown aria-hidden="true" />
      </span>
    </button>
  );
}

/** An external hand-off row: opens `href` in the browser, wearing the ↗ tell. */
export function SettingLinkRow({
  label,
  href,
  testId,
}: {
  readonly label: string;
  readonly href: string;
  readonly testId?: string;
}): ReactElement {
  return (
    <a
      className="setting-row setting-row--press"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <span className="setting-row__label">{label}</span>
      <ArrowUpRight className="setting-row__external" aria-hidden="true" />
    </a>
  );
}

/** The one switch shape for boolean prefs (44px hit via slop, amber = on). */
export function SettingSwitch({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  readonly checked: boolean;
  onChange(checked: boolean): void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}): ReactElement {
  return (
    <Switch.Root
      className="setting-switch"
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label={label}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <Switch.Thumb className="setting-switch__thumb" />
    </Switch.Root>
  );
}
