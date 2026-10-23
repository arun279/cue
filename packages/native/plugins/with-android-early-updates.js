const { withMainApplication } = require("expo/config-plugins");

// expo-updates holds MainActivity's load until its launcher has picked a bundle; starting it here
// overlaps that with creating the activity. start() opens a database, so it runs off the main thread.
const EARLY_START = `    if (!BuildConfig.DEBUG) {
      expo.modules.updates.UpdatesController.initializeWithoutStarting(this, false)
      Thread({ expo.modules.updates.UpdatesController.instance.start() }, "expo-updates-start").start()
    }`;

const ANCHOR = /^ *ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)\n/m;

function startUpdatesEarly(source) {
  if (source.includes(EARLY_START)) return source;
  if (!ANCHOR.test(source))
    throw new Error("MainApplication.onCreate no longer starts Expo's modules");
  return source.replace(ANCHOR, (line) => `${line}${EARLY_START}\n`);
}

module.exports = function withAndroidEarlyUpdates(config) {
  return withMainApplication(config, (cfg) => {
    cfg.modResults.contents = startUpdatesEarly(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.startUpdatesEarly = startUpdatesEarly;
