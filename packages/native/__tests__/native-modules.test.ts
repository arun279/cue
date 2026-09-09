const version = (name: string): string =>
  (require(`${name}/package.json`) as { version: string }).version;

/**
 * `@expo/ui` ships Swift that calls into `expo-modules-core`'s own Swift API, so
 * a release of it built against a newer core does not compile at all: 57.0.16
 * calls `ShadowNodeProxy.setContentOrigin`, which the core this app resolves has
 * never had, and the whole iOS app fails to build on it.
 *
 * `expo install` resolves the newest release in the SDK's major line rather than
 * the one matching the resolved core, so the mismatch arrives by default and the
 * only place it shows up is a native build. This is that build's answer in one
 * second instead of ten minutes.
 */
it("keeps the SwiftUI package level with the core whose Swift it calls", () => {
  expect(version("@expo/ui")).toBe(version("expo-modules-core"));
});
