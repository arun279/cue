const { startUpdatesEarly } = require("../plugins/with-android-early-updates");

const ON_CREATE = `  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
`;

it("starts expo-updates in a release build's onCreate, after Expo's modules, building the controller before starting it off the main thread", () => {
  const lines = startUpdatesEarly(ON_CREATE)
    .split("\n")
    .map((line: string) => line.trim());
  const at = (text: string) => lines.findIndex((line: string) => line.startsWith(text));

  expect(at("if (!BuildConfig.DEBUG)")).toBe(
    at("ApplicationLifecycleDispatcher.onApplicationCreate(this)") + 1,
  );
  expect(lines[at("if (!BuildConfig.DEBUG)") + 1]).toBe(
    "expo.modules.updates.UpdatesController.initializeWithoutStarting(this, false)",
  );
  expect(lines[at("if (!BuildConfig.DEBUG)") + 2]).toBe(
    'Thread({ expo.modules.updates.UpdatesController.instance.start() }, "expo-updates-start").start()',
  );
  expect(at("if (!BuildConfig.DEBUG)")).toBeLessThan(lines.lastIndexOf("}"));
});

it("leaves an already patched onCreate as it is", () => {
  const once = startUpdatesEarly(ON_CREATE);

  expect(startUpdatesEarly(once)).toBe(once);
});

it("fails the build rather than skip the start when onCreate no longer starts Expo's modules", () => {
  expect(() =>
    startUpdatesEarly(ON_CREATE.replace("ApplicationLifecycleDispatcher", "Other")),
  ).toThrow("no longer starts Expo's modules");
});
