const { withGradleProperties } = require("expo/config-plugins");

// D8 runs out of heap in :app:mergeDexRelease at the template's -Xmx2048m.
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
