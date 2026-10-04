import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
const RESOURCE = /\.(?:bmp|gif|jpe?g|png|webp|xml)$/;
const SKIPPED = new Set(["android", "dist", "ios", "node_modules"]);
const resources = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return SKIPPED.has(entry.name) || entry.name.startsWith(".") ? [] : resources(file);
    return RESOURCE.test(entry.name) ? [file] : [];
  });
const androidResources =
  platform === "android"
    ? resources(project)
        .map((file) => [
          path.relative(project, file).split(path.sep).join("/"),
          createHash("sha256").update(readFileSync(file)).digest("hex"),
        ])
        .sort(([a], [b]) => (a < b ? -1 : 1))
    : [];
const hash = await createProjectHashAsync(project, {
  extraSources: [
    {
      type: "contents",
      id: "ciBuildEnvironment",
      contents: JSON.stringify(buildEnvironment),
      reasons: ["workflow build environment"],
    },
    ...(androidResources.length === 0
      ? []
      : [
          {
            type: "contents",
            id: "androidResources",
            contents: JSON.stringify(androidResources),
            reasons: ["images the Android build compiles into resources"],
          },
        ]),
  ],
  platforms: [platform],
  silent: true,
});
process.stdout.write(hash);
