const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// Expo's Metro config has built-in monorepo support, and its own guide says not
// to configure it by hand: `watchFolders`, `resolver.nodeModulesPaths`,
// `resolver.extraNodeModules` and `resolver.disableHierarchicalLookup` are the
// four settings a manual config sets and this one must not.
const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, moduleName, platform) =>
  platform === "android" && moduleName === "@expo-google-fonts/material-symbols/400Regular"
    ? context.resolveRequest(context, path.join(__dirname, "metro/material-symbols.js"), platform)
    : context.resolveRequest(context, moduleName, platform);

module.exports = config;
