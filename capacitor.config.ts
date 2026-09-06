import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.cuetracker",
  appName: "Cue",
  webDir: "packages/web/dist",
  // The web app is a workspace package, so its Capacitor plugins are declared in
  // packages/web/package.json, where the code that imports them lives. Capacitor
  // discovers plugins from the manifest beside this file, which is the root's,
  // so the shells' plugin set is named here instead of inferred. Adding a plugin
  // to the web package without adding it here leaves it out of the binaries.
  includePlugins: [
    "@capacitor/app",
    "@capacitor/local-notifications",
    "@capacitor/preferences",
    "@capacitor/status-bar",
  ],
  // Capacitor ships zoom off on both platforms by default, which strands anyone who needs to
  // magnify a poster or a synopsis. Worse, the off state is not even coherent on iOS: double-tap
  // to zoom still fires while the pinch recognizer is killed, so a reader can land magnified with
  // no gesture left to get back. Both platforms read this top-level key when their own block is
  // absent, so one line covers iOS and Android.
  zoomEnabled: true,
};

export default config;
