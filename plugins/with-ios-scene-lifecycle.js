const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// iOS 27 SDK apps must adopt UIScene (Apple TN3187, expo/expo#46663); delete once expo/expo#46733 and #47628 ship.
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
