import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectHashAsync } from "@expo/fingerprint";

const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") {
  throw new Error("usage: native-fingerprint.mjs <ios|android>");
}

const names =
  platform === "ios"
    ? ["CONFIGURATION", "EXPO_PUBLIC_TRAKT_API_BASE", "EXPO_PUBLIC_TRAKT_CLIENT_ID", "XCODE_PATH"]
    : ["APP_VERSION", "BUILD_NUMBER", "EXPO_PUBLIC_TRAKT_API_BASE", "EXPO_PUBLIC_TRAKT_CLIENT_ID"];
const buildEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name] ?? ""]));
const project = path.join(path.dirname(fileURLToPath(import.meta.url)), "../packages/native");
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
