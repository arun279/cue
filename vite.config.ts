import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // plugin wired minimally — precache manifest + SW are generated, but
    // registration is deferred (injectRegister: null) so no service worker runs
    // yet. Full app-shell precache + bounded image cache land in a later milestone.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: {
        name: "Cue",
        short_name: "Cue",
        description: "Your Up Next queue.",
        theme_color: "#0b0b0f",
        background_color: "#0b0b0f",
        display: "standalone",
        start_url: "/",
      },
      workbox: { globPatterns: ["**/*.{js,css,html}"] },
    }),
  ],
  resolve: {
    alias: {
      "@domain": src("domain"),
      "@data": src("data"),
      "@ui": src("ui"),
      "@app": src("app"),
      "@platform": src("platform"),
    },
  },
});
