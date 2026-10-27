const { getDefaultConfig } = require("expo/metro-config");

// Drops expo-symbols and its 963 kB Material Symbols font, which only NativeTabs `md` icons use.
process.env.EXPO_ROUTER_DISABLE_NATIVE_TABS_MD ??= "1";

module.exports = getDefaultConfig(__dirname);
