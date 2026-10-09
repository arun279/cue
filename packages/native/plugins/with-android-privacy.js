const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RULES_RESOURCE = "cue_data_extraction_rules";
const RULES_PATH = join("app", "src", "main", "res", "xml", `${RULES_RESOURCE}.xml`);

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

// allowBackup defaults to true, and false alone does not stop Android 12+ device-to-device transfer.
module.exports = function withAndroidPrivacy(config, { apiBase } = {}) {
  const origin = URL.parse(apiBase ?? "");
  const allowLoopback =
    origin?.protocol === "http:" &&
    (origin.hostname === "127.0.0.1" || origin.hostname === "localhost");
  const withRules = withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = join(cfg.modRequest.platformProjectRoot, RULES_PATH);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, RULES, "utf8");
      if (allowLoopback) {
        writeFileSync(
          join(dirname(file), "cue_network_security.xml"),
          `<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">${origin.hostname}</domain>
    </domain-config>
</network-security-config>
`,
        );
      }
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
    if (allowLoopback) {
      application.$["android:networkSecurityConfig"] = "@xml/cue_network_security";
    }
    return cfg;
  });
};
