const { withGradleProperties } = require("expo/config-plugins");

/**
 * The Gradle JVM heap the release build needs. Expo's Android template writes
 * `-Xmx2048m`, and D8 runs out of heap merging this app's dex archives at that
 * size: React Native, Hermes, reanimated, screens and the Expo modules together
 * are past what 2 GB holds, and the failure is an `OutOfMemoryError` inside
 * `:app:mergeDexRelease` rather than anything the app's own code can answer for.
 * It is set here rather than in a checked-in `gradle.properties` because
 * `android/` is prebuild output, so a value written by hand does not survive the
 * next `expo prebuild --clean`.
 */
const JVM_ARGS = "-Xmx4g -XX:MaxMetaspaceSize=1g";

module.exports = function withAndroidBuildMemory(config) {
  return withGradleProperties(config, (mod) => {
    const property = mod.modResults.find(
      (entry) => entry.type === "property" && entry.key === "org.gradle.jvmargs",
    );
    if (property === undefined) {
      mod.modResults.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    } else {
      property.value = JVM_ARGS;
    }
    return mod;
  });
};
