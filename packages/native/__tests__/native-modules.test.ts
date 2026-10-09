const version = (name: string): string =>
  (require(`${name}/package.json`) as { version: string }).version;

/**
 * `@expo/ui` ships Swift that calls into `expo-modules-core`'s own Swift API, so
 * a release of it built against a newer core does not compile at all: 57.0.16
 * calls `ShadowNodeProxy.setContentOrigin`, which the core this app resolved
 * then had never had, and the whole iOS app failed to build on it.
 *
 * `expo install` resolves the newest release in the SDK's major line rather than
 * the one released with the resolved expo, so the mismatch arrives by default and
 * the only place it shows up is a native build. The two packages do not share
 * version numbers, so the pin is checked against the release expo itself names.
 */
it("keeps the SwiftUI package at the release the installed expo bundles", () => {
  const bundled = require("expo/bundledNativeModules.json") as Record<string, string>;
  expect(`~${version("@expo/ui")}`).toBe(bundled["@expo/ui"]);
});
