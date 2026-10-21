// Metro does not need this file; the jest lane does. Without it `babel-jest`
// finds no config, does not strip the Flow types out of `@react-native/jest-preset`'s
// own setup file, and every suite dies before a test runs.
const HARNESS = process.env.EXPO_PUBLIC_UI_HARNESS === "1";
const PERF_HOOKS = new Set(["usePerfCommand", "usePerfScroll"]);

// Store builds have no perf channel, so its registrations are removed where they are called.
const stripPerfCommands = () => ({
  visitor: {
    CallExpression(path) {
      if (PERF_HOOKS.has(path.node.callee.name) && path.parentPath.isExpressionStatement())
        path.parentPath.remove();
    },
  },
});

module.exports = (api) => {
  api.cache.using(() => HARNESS);
  return { presets: ["babel-preset-expo"], plugins: HARNESS ? [] : [stripPerfCommands] };
};
