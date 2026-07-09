import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativePlatform } from "./platform";

/**
 * Match the native status-bar text/icons to Cue's active theme
 * so a dark bar never sits unreadable over a dark app. `Style.Dark` renders light
 * text (for Cue's dark screening-room default); `Style.Light` renders dark text
 * for the light theme. Driven by the theme store and re-called on every toggle.
 * No-op on web / in tests — the browser owns its own chrome — and swallows any
 * plugin rejection so a theme change never throws.
 */
export function applyStatusBarTheme(theme: "light" | "dark"): void {
  if (!isNativePlatform()) return;
  void StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
}
