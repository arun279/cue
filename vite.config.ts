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
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Cue",
        short_name: "Cue",
        description: "Your Up Next queue.",
        theme_color: "#0e0c0a",
        background_color: "#0e0c0a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg}"] },
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
