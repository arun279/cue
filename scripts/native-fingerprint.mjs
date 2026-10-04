import { fileURLToPath } from "node:url";
import { createProjectHashAsync } from "@expo/fingerprint";

const [platform, project = fileURLToPath(new URL("../packages/native", import.meta.url))] =
  process.argv.slice(2);
if (platform !== "ios" && platform !== "android") {
  throw new Error("usage: native-fingerprint.mjs <ios|android> [project]");
}

const names =
  platform === "ios"
    ? [
        "CONFIGURATION",
        "EAS_UPDATE_CHANNEL",
        "EXPO_PUBLIC_TRAKT_API_BASE",
        "EXPO_PUBLIC_TRAKT_CLIENT_ID",
        "XCODE_PATH",
      ]
    : [
        "ANDROID_ARCHITECTURES",
        "APP_VERSION",
        "BUILD_NUMBER",
        "EAS_UPDATE_CHANNEL",
        "EXPO_PUBLIC_TRAKT_API_BASE",
        "EXPO_PUBLIC_TRAKT_CLIENT_ID",
      ];
const missing = names.filter((name) => process.env[name] === undefined);
if (missing.length > 0) {
  throw new Error(`native-fingerprint.mjs needs the build environment: ${missing.join(", ")}`);
}
const buildEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const hash = await createProjectHashAsync(project, {
  extraSources: [
    {
      type: "contents",
      id: "ciBuildEnvironment",
      contents: JSON.stringify(buildEnvironment),
      reasons: ["workflow build environment"],
    },
  ],
  platforms: [platform],
  silent: true,
});
process.stdout.write(hash);
