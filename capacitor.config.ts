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
  // Capacitor ships zoom off on both platforms by default, which strands anyone who needs to
  // magnify a poster or a synopsis. Worse, the off state is not even coherent on iOS: double-tap
  // to zoom still fires while the pinch recognizer is killed, so a reader can land magnified with
  // no gesture left to get back. Both platforms read this top-level key when their own block is
  // absent, so one line covers iOS and Android.
  zoomEnabled: true,
};

export default config;
