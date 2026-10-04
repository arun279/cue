import type { ExpoConfig } from "expo/config";

const EXPO_TEMPLATE_EXTRAS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  // View.performHapticFeedback needs no VIBRATE permission.
  "android.permission.VIBRATE",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];
const SECURE_STORE_BIOMETRICS = [
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
];
const INSTALL_REFERRER = ["com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE"];
const PUSH_AND_BADGES = [
  "android.permission.WAKE_LOCK",
  "com.google.android.c2dm.permission.RECEIVE",
  "android.permission.READ_APP_BADGE",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

// babel-preset-expo replaces process.env.EXPO_PUBLIC_* at transform time, so the environment is a parameter.
export function nativeAppConfig(env: Readonly<Record<string, string | undefined>>): ExpoConfig {
  const buildNumber = env["BUILD_NUMBER"] ?? "1";

  // ATS blocks plain HTTP even to loopback addresses, so a harness build needs an exception domain.
  const mockTrakt = env["EXPO_PUBLIC_TRAKT_API_BASE"];
  const mockTraktHost =
    mockTrakt === undefined || mockTrakt === "" ? null : new URL(mockTrakt).hostname;

  return {
    name: "Cue",
    slug: "cue",
    owner: "arunkris",
    scheme: "cue",
    version: env["APP_VERSION"] ?? "2.0.0",
    icon: "./assets/icon.png",
    orientation: "default",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: "app.cuetracker",
      supportsTablet: true,
      buildNumber,
      // Undeclared, App Store Connect holds every build at Missing Compliance.
      config: { usesNonExemptEncryption: false },
      ...(mockTraktHost === null
        ? {}
        : {
            infoPlist: {
              // Expo replaces this dictionary rather than merging, so the template's keys are restated.
              NSAppTransportSecurity: {
                NSAllowsArbitraryLoads: false,
                NSAllowsLocalNetworking: true,
                NSExceptionDomains: {
                  [mockTraktHost]: { NSExceptionAllowsInsecureHTTPLoads: true },
                },
              },
            },
          }),
    },
    android: {
      package: "app.cuetracker",
      versionCode: Number(buildNumber),
      blockedPermissions: [
        ...EXPO_TEMPLATE_EXTRAS,
        ...SECURE_STORE_BIOMETRICS,
        ...INSTALL_REFERRER,
        ...PUSH_AND_BADGES,
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/icon-foreground.png",
        backgroundColor: "#0e0c0a",
      },
    },
    plugins: [
      "expo-router",
      [
        "expo-build-properties",
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
          ios: { usePrecompiledModules: false },
        },
      ],
      ["expo-secure-store", { configureAndroidBackup: false, faceIDPermission: false }],
      "expo-sqlite",
      "expo-status-bar",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          imageWidth: 256,
          resizeMode: "contain",
          backgroundColor: "#0e0c0a",
          dark: {
            image: "./assets/splash.png",
            backgroundColor: "#0e0c0a",
          },
        },
      ],
      "./plugins/with-android-build-memory",
      "./plugins/with-android-tab-icons",
      ["./plugins/with-android-privacy", { apiBase: mockTrakt }],
      "./plugins/with-ios-scene-lifecycle",
      "./plugins/with-ios-local-notifications",
    ],
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      url: "https://u.expo.dev/2f8d848b-c45a-4883-a077-0e1a03455af9",
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      requestHeaders: { "expo-channel-name": env["EAS_UPDATE_CHANNEL"] ?? "preview" },
    },
    extra: { eas: { projectId: "2f8d848b-c45a-4883-a077-0e1a03455af9" } },
    experiments: { typedRoutes: true },
  };
}

export default (): ExpoConfig => nativeAppConfig(process.env);
