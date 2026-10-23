const { withMainApplication } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// expo-updates holds MainActivity's load until its launcher has picked a bundle; starting it here
// overlaps that with creating the activity. start() opens a database, so it runs off the main thread.
const EARLY_START = `    if (!BuildConfig.DEBUG) {
      expo.modules.updates.UpdatesController.initializeWithoutStarting(this, false)
      Thread({ expo.modules.updates.UpdatesController.instance.start() }, "expo-updates-start").start()
    }`;

function startUpdatesEarly(source) {
  return mergeContents({
    src: source,
    newSrc: EARLY_START,
    tag: "cue-early-updates",
    anchor: /ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)/,
    offset: 1,
    comment: "//",
  }).contents;
}

module.exports = function withAndroidEarlyUpdates(config) {
  return withMainApplication(config, (cfg) => {
    cfg.modResults.contents = startUpdatesEarly(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.startUpdatesEarly = startUpdatesEarly;
