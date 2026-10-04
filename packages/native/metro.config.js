const { realpathSync } = require("node:fs");
const path = require("node:path");
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

if (process.env.EXPO_PUBLIC_UI_HARNESS !== "1") {
  const harness = realpathSync(path.join(__dirname, "src/ui/harness.tsx"));
  const store = path.join(__dirname, "src/ui/harness.store.ts");
  const { resolveRequest } = config.resolver;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolution = (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
    return resolution.type === "sourceFile" &&
      path.basename(resolution.filePath) === "harness.tsx" &&
      realpathSync(resolution.filePath) === harness
      ? { type: "sourceFile", filePath: store }
      : resolution;
  };
}

module.exports = config;
