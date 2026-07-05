import { AppProviders } from "@app/providers";
import { applyTheme } from "@ui/theme/theme";
import { useThemeStore } from "@ui/theme/theme-store";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ui/styles.css";

// Paint the resolved theme before first render so there is no light/dark flash.
applyTheme(useThemeStore.getState().theme);

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
