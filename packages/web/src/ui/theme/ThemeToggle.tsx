import { SegmentedControl } from "@ui/components/SegmentedControl";
import type { ThemePreference } from "@ui/theme/theme";
import { useThemeStore } from "@ui/theme/theme-store";
import type { ReactElement } from "react";

const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** The Settings ▸ Appearance theme control: System / Dark / Light. */
export function ThemeToggle(): ReactElement {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <SegmentedControl
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
      ariaLabel="Theme"
      testId="theme-toggle"
    />
  );
}
