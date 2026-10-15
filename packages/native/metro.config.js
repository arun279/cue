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

const harness = process.env.EXPO_PUBLIC_UI_HARNESS === "1";
const replacements = new Map(
  (harness
    ? [["../core/src/stores/snackbar-policy.ts", "src/ui/snackbar-policy.harness.ts"]]
    : [["src/ui/harness.tsx", "src/ui/harness.store.ts"]]
  ).map(([source, target]) => [
    realpathSync(path.join(__dirname, source)),
    path.join(__dirname, target),
  ]),
);
const replacementNames = new Set([...replacements.keys()].map((source) => path.basename(source)));
const { resolveRequest } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolution = (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  const replacement =
    resolution.type === "sourceFile" && replacementNames.has(path.basename(resolution.filePath))
      ? replacements.get(realpathSync(resolution.filePath))
      : undefined;
  return replacement === undefined ? resolution : { type: "sourceFile", filePath: replacement };
};

module.exports = config;
