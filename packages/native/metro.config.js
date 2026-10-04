const { getDefaultConfig } = require("expo/metro-config");

// Nothing here uses NativeTabs `md` icons, and Expo's own flag is what drops
// them: the Android material-icon converter is swapped for a stub, so
// expo-symbols and the 963 kB Material Symbols font it imports leave the
// bundle. Set here rather than per command so every Metro run agrees.
process.env.EXPO_ROUTER_DISABLE_NATIVE_TABS_MD ??= "1";

// Expo's Metro config has built-in monorepo support, and its own guide says not
// to configure it by hand: `watchFolders`, `resolver.nodeModulesPaths`,
// `resolver.extraNodeModules` and `resolver.disableHierarchicalLookup` are the
// four settings a manual config sets and this one must not.
const config = getDefaultConfig(__dirname);

// `expo export` bundles its platforms concurrently through one module ID
// counter, so a bundle's IDs, and its size, depended on which platform reached
// a module first. A counter per platform numbers each bundle as a
// single-platform build does.
const { createModuleIdFactory } = config.serializer;
config.serializer.createModuleIdFactory = () => {
  const byPlatform = new Map();
  return (path, context) => {
    const platform = context?.platform;
    if (!byPlatform.has(platform)) byPlatform.set(platform, createModuleIdFactory());
    return byPlatform.get(platform)(path, context);
  };
};

module.exports = config;
