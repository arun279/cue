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
 */
const project = {
  testMatch: ["<rootDir>/__tests__/**/*.test.{ts,tsx}"],
  moduleNameMapper: { "^vitest$": "<rootDir>/__tests__/support/vitest.ts" },
};

module.exports = {
  projects: [
    { ...project, preset: "jest-expo/ios", displayName: "ios" },
    { ...project, preset: "jest-expo/android", displayName: "android" },
  ],
};
