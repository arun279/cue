import type { ExpoConfig } from "expo/config";

/**
 * Every permission somebody else's manifest declares and Cue does not want, in
 * the one place Android documents for dropping them. `verify-apk.sh` pins the
 * set that survives, out of the built APK, so a new arrival fails a build rather
 * than shipping unannounced.
 *
 * Four groups, and each is a decision rather than tidiness:
 *
 * - **Expo's prebuild template**, whose own comment calls these optional.
 *   Haptics go through `performHapticFeedback`, which Android documents as not
 *   requiring VIBRATE; nothing reads or writes shared storage; nothing draws
 *   over other apps. SYSTEM_ALERT_WINDOW is re-declared by the debug flavour for
 *   the development menu and is absent from a release build either way.
 * - **The biometric pair**, from expo-secure-store's optional authenticated
 *   reads. Cue never passes `requireAuthentication`, which is also why the Face
 *   ID usage description is turned off below.
 * - **The Play install-referrer binding**, from expo-application's transitive
 *   install-referrer library. Cue reads its version fields and never asks for
 *   install referrer data.
 * - **Push and badges**, from expo-notifications' Firebase messaging and
 *   ShortcutBadger: the FCM receive permission and its wake lock, and the per-OEM
 *   launcher badge set. Cue schedules local notifications only and sets no badge
 *   count. What survives is POST_NOTIFICATIONS, which Android 13 and later
 *   requires to show any notification, and RECEIVE_BOOT_COMPLETED, which is how
 *   the scheduled alerts come back after a reboot.
 */
const BLOCKED_PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.VIBRATE",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
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

/**
 * The native app's identity and its generated projects, under Continuous Native
 * Generation: `ios/` and `android/` are prebuild output and are not committed,
 * so every native fact the app depends on is stated here or in a config plugin.
 *
 * A function of the environment rather than `app.json`, because two of those
 * facts come from it. `BUILD_NUMBER` and `APP_VERSION` are what the release lane
 * computes; under CNG prebuild writes them into both projects.
 *
 * The environment is a parameter rather than a global read because that is what
 * makes the four release blockers below testable: `babel-preset-expo` replaces
 * every literal `process.env.EXPO_PUBLIC_*` with its value at transform time,
 * which is what the app bundle wants and what would otherwise freeze this file's
 * harness branch to whatever the test runner started with.
 */
export function nativeAppConfig(env: Readonly<Record<string, string | undefined>>): ExpoConfig {
  const buildNumber = env["BUILD_NUMBER"] ?? "1";

  /**
   * The fake Trakt's origin, and the one reason this app would ever load plain
   * HTTP. Read here so a build that is not pointed at the harness adds no ATS
   * exception domains. The generated-project privacy gate requires arbitrary
   * loads to stay disabled and exception domains to stay absent.
   *
   * ATS is not optional for this: it blocks a plain-HTTP load to a bare IP
   * address, loopback included, so a simulator build with no exception cannot
   * reach the harness at all.
   */
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
    // The shipping app allows portrait and both landscapes on iPhone and all
    // four on iPad; "default" preserves that instead of narrowing it.
    orientation: "default",
    // The app has a light theme, a dark theme and a System option that tracks
    // live OS changes, so the native shell follows the system too.
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: "app.cuetracker",
      supportsTablet: true,
      buildNumber,
      ...(mockTraktHost === null
        ? {}
        : {
            infoPlist: {
              // Expo replaces the whole dictionary rather than merging into it,
              // so the prebuild template's own two keys are restated here. Left
              // out, the harness build silently drops the app's declaration that
              // arbitrary loads are off, which is the claim the privacy gate on
              // the generated project exists to hold.
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
      predictiveBackGestureEnabled: true,
      blockedPermissions: BLOCKED_PERMISSIONS,
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
      // Cue writes `allowBackup="false"` and its own data-extraction rules, and
      // this plugin writes both itself by default; told to stand down, it leaves
      // them to with-android-privacy, whose `sharedpref path="."` exclusion
      // covers the SecureStore file the plugin would have named on its own.
      // `faceIDPermission: false` drops the Face ID usage description it also
      // writes by default: Cue never passes `requireAuthentication`, and a usage
      // description for a capability the app does not use is a false claim on
      // the App Store privacy surface.
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
