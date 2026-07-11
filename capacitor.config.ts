import type { CapacitorConfig } from "@capacitor/cli";

// TODO(ios-edge-swipe): when the iOS shell is generated, set WKWebView
// `allowsBackForwardNavigationGestures = true` in an `ios` block here so the left-edge
// swipe-back pops the router. The router uses browser history (no
// explicit history passed to createRouter), so the WKWebView gesture maps 1:1 to
// `router.history.back()`: no JS pan shim needed.
const config: CapacitorConfig = {
  appId: "app.cuetracker",
  appName: "Cue",
  webDir: "dist",
};

export default config;
