import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// The build's identity, and with it the persisted-cache buster (query-client.ts).
// Deriving it here is what makes a persisted-shape change self-retiring: no commit
// can ship a new shape that an older cache is still replayed against.
const buildId = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  // Fixed dev port so the OAuth Redirect URI registered on the Trakt app
  // (http://localhost:5199/auth/callback) matches exactly (RFC 9700 requires an
  // exact redirect-URI match); strictPort fails fast rather than drifting to 5200.
  server: { port: 5199, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    // plugin wired minimally: precache manifest + SW are generated, but
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
