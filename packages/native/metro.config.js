const { getDefaultConfig } = require("expo/metro-config");

// Drops expo-symbols and its 963 kB Material Symbols font, which only NativeTabs `md` icons use.
process.env.EXPO_ROUTER_DISABLE_NATIVE_TABS_MD ??= "1";

const config = getDefaultConfig(__dirname);

// `expo export` shares one module ID counter across the platforms it bundles concurrently.
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
