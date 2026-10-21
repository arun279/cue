// Metro does not need this file; the jest lane does. Without it `babel-jest`
// finds no config, does not strip the Flow types out of `@react-native/jest-preset`'s
// own setup file, and every suite dies before a test runs.
const HARNESS = process.env.EXPO_PUBLIC_UI_HARNESS === "1";
const PERF_HOOKS = new Set(["usePerfCommand", "usePerfScroll"]);

const callStatements = (binding) => binding.referencePaths.map((reference) => reference.parentPath);

const removable = (calls) =>
  calls.every((call) => call.isCallExpression() && call.parentPath.isExpressionStatement());

function stripSpecifier(program, specifier) {
  if (!PERF_HOOKS.has(specifier.node.imported?.name)) return;
  const calls = callStatements(program.scope.getBinding(specifier.node.local.name));
  if (!removable(calls)) return;
  for (const call of calls) call.parentPath.remove();
  specifier.remove();
}

// Store builds have no perf channel, so its registrations are removed where they are called.
const stripPerfCommands = () => ({
  visitor: {
    ImportDeclaration(declaration) {
      if (!declaration.node.source.value.endsWith("/harness")) return;
      const program = declaration.parentPath;
      for (const specifier of declaration.get("specifiers")) stripSpecifier(program, specifier);
      if (declaration.node.specifiers.length === 0) declaration.remove();
    },
  },
});

module.exports = (api) => {
  api.cache.using(() => HARNESS);
  return { presets: ["babel-preset-expo"], plugins: HARNESS ? [] : [stripPerfCommands] };
};
