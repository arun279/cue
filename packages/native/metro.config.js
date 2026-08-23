const { getDefaultConfig } = require("expo/metro-config");

// Expo's Metro config has built-in monorepo support, and its own guide says not
// to configure it by hand: `watchFolders`, `resolver.nodeModulesPaths`,
// `resolver.extraNodeModules` and `resolver.disableHierarchicalLookup` are the
// four settings a manual config sets and this one must not.
module.exports = getDefaultConfig(__dirname);
