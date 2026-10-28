/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // The scripts and .gitignore serve the repository's tooling; neither reaches the native build.
  sourceSkips: ["ExpoConfigVersions", "PackageJsonScriptsAll", "GitIgnore"],
};
