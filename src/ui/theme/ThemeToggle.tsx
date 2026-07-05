import { useThemeStore } from "@ui/theme/theme-store";
import { Switch } from "radix-ui";
import type { ReactElement } from "react";

export function ThemeToggle(): ReactElement {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const isDark = theme === "dark";

  return (
    <div className="theme-toggle">
      <span className="theme-toggle__label" aria-hidden="true">
        Dark theme
      </span>
      <Switch.Root
        className="switch"
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Dark theme"
        data-testid="theme-toggle"
      >
        <Switch.Thumb className="switch__thumb" />
      </Switch.Root>
    </div>
  );
}
