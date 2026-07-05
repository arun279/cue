import { platformName } from "@platform/native";
import { App } from "@ui/App";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ui/styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App platform={platformName()} />
  </StrictMode>,
);
