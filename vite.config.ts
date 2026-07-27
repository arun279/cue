import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

/**
 * The persisted-cache buster (query-client.ts): a content hash over the trees that
 * DEFINE every persisted shape. `ui/runtime` types every cached value, and those
 * types resolve entirely into `data` and `domain`, so no shape a restored cache is
 * replayed against can change without changing a byte here. Sorted paths keep the
 * hash identical across machines.
 *
 * A shape hash rather than the commit id: the id moves on every commit, so every
 * release would throw away instant paint for every user, and it does NOT move for
 * uncommitted working-tree edits, so it misses the exact drift it exists to catch
 * while the shape is being changed. It also needs no `.git`, so a build from a
 * source tarball or a checkout-less container still produces a real buster.
 * Over-busting (a comment edit in `data`) costs one cold paint; under-busting is
 * silent, permanent corruption, so the boundary is drawn wide.
 */
function persistBuster(trees: readonly string[]): string {
  const hash = createHash("sha256");
  for (const tree of trees) {
    const root = src(tree);
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
      const path = join(root, entry);
      if (!statSync(path).isFile()) continue;
      hash.update(`${tree}/${entry}\0`).update(readFileSync(path));
    }
  }
  return hash.digest("hex").slice(0, 12);
}

export default defineConfig({
  define: { __PERSIST_BUSTER__: JSON.stringify(persistBuster(["domain", "data", "ui/runtime"])) },
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
