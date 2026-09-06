/**
 * `projects` over `jest-expo/ios` and `jest-expo/android` rather than the
 * universal preset: the universal one also runs every test under web and node,
 * and this app has no web target, so those two runs would assert nothing while
 * doubling the suite. Running both of the two that do ship is the point, because
 * it is what catches an Android-only divergence in the legacy-preferences key
 * shape or the haptics bridge.
 *
 * `testMatch` names the test files rather than the directory, so a support
 * module beside them is not itself run as a suite with no tests in it.
 *
 * `moduleNameMapper` points `vitest` at a shim over jest's own globals: the
 * shared `KeyValueStore` contract lives in `@cue/core`'s test tree and is run by
 * both runners rather than transcribed into a second copy.
 *
 * `nanoid` is added to jest-expo's transform allow-list rather than the list
 * being restated: expo-router's vendored React Navigation imports
 * `nanoid/non-secure`, which ships as ESM only, and jest-expo's own list stops
 * at the Expo and React Navigation scopes.
 */
const { transformIgnorePatterns } = require("jest-expo/jest-preset");

const project = {
  testMatch: ["<rootDir>/__tests__/**/*.test.{ts,tsx}"],
  // The gesture root installs a native binding on mount; without its own setup
  // every screen that renders under one fails before it draws anything.
  setupFiles: [require.resolve("react-native-gesture-handler/jestSetup")],
  setupFilesAfterEnv: ["<rootDir>/__tests__/support/reanimated.ts"],
  // Worklets is a native library and its `.native` entry points reach a binding
  // this runner has no host for. Its own resolver picks the web implementation
  // instead, which is the shape a JS-only test can actually run.
  resolver: "react-native-worklets/jest/resolver",
  moduleNameMapper: { "^vitest$": "<rootDir>/__tests__/support/vitest.ts" },
  transformIgnorePatterns: transformIgnorePatterns.map((pattern) =>
    pattern.replace("(?!(", "(?!(nanoid|"),
  ),
};

module.exports = {
  projects: [
    { ...project, preset: "jest-expo/ios", displayName: "ios" },
    { ...project, preset: "jest-expo/android", displayName: "android" },
  ],
};
