const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

/**
 * Adopt the UIKit scene-based life cycle so the app launches on the iOS 27 SDK.
 *
 * Apps linked against that SDK must adopt scenes; Expo's prebuild template still
 * starts React Native from `application(_:didFinishLaunchingWithOptions:)` and
 * ships no `UIApplicationSceneManifest`, so a stock SDK 57 prebuild installs and
 * then refuses to launch with "UIScene life cycle is required for apps built
 * with this SDK" (expo/expo#46663, facebook/react-native#54739, Apple TN3187).
 *
 * The delegate is appended to `AppDelegate.swift` rather than added as its own
 * file, so the plugin never edits the Xcode project's build phases: the scene
 * manifest names `$(PRODUCT_MODULE_NAME).SceneDelegate`, which resolves to the
 * same module either way.
 *
 * Delete this plugin when expo/expo#46733 and its follow-up expo/expo#47628 both
 * reach a published SDK, and re-verify cold-start URL delivery on the way out:
 * that is the half upstream took two attempts to get right.
 */
const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(from: connectionOptions)
    )
  }

  // On a scene cold launch the launch URL and the handed-off user activity
  // arrive in the connection options, not through the app delegate (TN3187), and
  // \`RCTLinkingManager\` answers \`Linking.getInitialURL()\` out of the launch
  // options the React root was started with. Passing nil here is what silently
  // discards every cold-launch deep link.
  private static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any] {
    var options: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      options[.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      options[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityKey": activity,
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
      ]
      options[.userActivityType] = activity.activityType
    }
    return options
  }

  // The scene life cycle also takes over URL delivery to a running app, so the
  // warm path has to be re-published here or expo-linking never sees it.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function adoptScenes(contents) {
  if (contents.includes("class SceneDelegate")) return contents;

  // The window is created by the scene, not the app delegate: leaving the
  // template's `startReactNative` call in `didFinishLaunchingWithOptions` would
  // mount a second React root into a window that is never attached to a scene.
  const startBlock =
    /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\([\s\S]*?\)\s*\n#endif\n/;
  if (!startBlock.test(contents)) {
    throw new Error(
      "with-ios-scene-lifecycle: AppDelegate.swift no longer starts React Native the way this plugin expects. Re-check it against the Expo template before trusting the patch.",
    );
  }
  return `${contents.replace(startBlock, "")}${SCENE_DELEGATE}`;
}

module.exports = function withIosSceneLifecycle(config) {
  const withManifest = withInfoPlist(config, (cfg) => {
    cfg.modResults["UIApplicationSceneManifest"] = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });

  return withAppDelegate(withManifest, (cfg) => {
    cfg.modResults.contents = adoptScenes(cfg.modResults.contents);
    return cfg;
  });
};
