import { nativeAppConfig } from "../app.config";

/**
 * The app config is the whole native identity under CNG, and four of the facts
 * in it are release blockers: a different bundle id is a different app on Play
 * rather than an upgrade, and a pinned orientation, a tablet opt-out or a
 * hard-coded color scheme each silently narrow what the shipping app already
 * does. None of them is visible until a build is in somebody's hands.
 */
describe("the native app config", () => {
  const config = nativeAppConfig({});

  it("is the same app on both stores", () => {
    expect(config.ios?.bundleIdentifier).toBe("app.cuetracker");
    expect(config.android?.package).toBe("app.cuetracker");
  });

  it("keeps the orientations, the tablet support and the system color scheme the shipping app has", () => {
    expect(config.orientation).toBe("default");
    expect(config.ios?.supportsTablet).toBe(true);
    expect(config.userInterfaceStyle).toBe("automatic");
  });

  // The whole merged set is pinned by `verify-apk.sh` out of the built APK,
  // which is the only place it can honestly be checked: any dependency's
  // manifest can add to it. This is the one entry worth naming here, because its
  // presence would put an "Alarms & reminders" screen in front of a user for a
  // permission the app never uses.
  it("never asks for an exact alarm", () => {
    expect(config.android?.blockedPermissions).toContain("android.permission.SCHEDULE_EXACT_ALARM");
  });

  it("takes the version and the build number from the environment", () => {
    const released = nativeAppConfig({ APP_VERSION: "2.1.0", BUILD_NUMBER: "4207" });
    expect(released.version).toBe("2.1.0");
    expect(released.ios?.buildNumber).toBe("4207");
    expect(released.android?.versionCode).toBe(4207);
  });

  it("targets the push environment its build configuration ships to", () => {
    expect(config.plugins).toContainEqual(["expo-notifications", { mode: "development" }]);
    expect(nativeAppConfig({ CONFIGURATION: "Release" }).plugins).toContainEqual([
      "expo-notifications",
      { mode: "production" },
    ]);
  });

  it("minifies release code and removes unused Android resources", () => {
    expect(config.plugins).toContainEqual([
      "expo-build-properties",
      {
        android: {
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ]);
  });

  it("carries no transport-security exception unless the harness asks for one", () => {
    expect(config.ios?.infoPlist).toBeUndefined();
    expect(nativeAppConfig({ EXPO_PUBLIC_TRAKT_API_BASE: "" }).ios?.infoPlist).toBeUndefined();

    const harness = nativeAppConfig({ EXPO_PUBLIC_TRAKT_API_BASE: "http://127.0.0.1:8787" });
    expect(harness.ios?.infoPlist?.["NSAppTransportSecurity"]).toEqual({
      NSExceptionDomains: { "127.0.0.1": { NSExceptionAllowsInsecureHTTPLoads: true } },
    });
  });
});
