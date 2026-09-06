const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RULES_RESOURCE = "cue_data_extraction_rules";
const RULES_PATH = join("app", "src", "main", "res", "xml", `${RULES_RESOURCE}.xml`);

/**
 * Every storage domain the platform can name, excluded from both channels.
 * Carried over verbatim from the Capacitor shell's committed rules, because the
 * claim they support is the one PRIVACY.md, docs/index.html and README.md all
 * make to users. `path="."` rather than a narrower path is what makes the
 * exclusion whole, which is also what covers the SecureStore shared-preferences
 * file; there is no `<include>` anywhere, because an include flips a section
 * back to being an allowlist.
 */
const RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
        <exclude domain="device_root" path="." />
        <exclude domain="device_file" path="." />
        <exclude domain="device_database" path="." />
        <exclude domain="device_sharedpref" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
        <exclude domain="device_root" path="." />
        <exclude domain="device_file" path="." />
        <exclude domain="device_database" path="." />
        <exclude domain="device_sharedpref" path="." />
    </device-transfer>
</data-extraction-rules>
`;

/**
 * Cue's app storage holds a live Trakt refresh token and a cache that one sync
 * rebuilds, so there is nothing worth restoring and one thing worth never
 * copying. Android's default for `allowBackup` is `true`, so a prebuilt app
 * silently opts back in without this and turns a documented privacy property
 * into a false statement. `allowBackup="false"` stops Google Drive backup and
 * `adb backup`; it does not stop device-to-device transfer on Android 12 and
 * later, which is what the rules above are for.
 *
 * There is no app-config property for either field, so the manifest is edited
 * directly, which is what Expo's own `withSecureStore` does. `verify-apk.sh`
 * asserts the result out of the built APK rather than trusting this plugin.
 */
module.exports = function withAndroidPrivacy(config) {
  const withRules = withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = join(cfg.modRequest.platformProjectRoot, RULES_PATH);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, RULES, "utf8");
      return cfg;
    },
  ]);

  return withAndroidManifest(withRules, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application === undefined) {
      throw new Error("with-android-privacy: the generated manifest has no <application> element.");
    }
    application.$["android:allowBackup"] = "false";
    application.$["android:dataExtractionRules"] = `@xml/${RULES_RESOURCE}`;
    return cfg;
  });
};
