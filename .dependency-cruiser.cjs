// dependency-cruiser matches every `to.path` against the *resolved* module
// path, not the import specifier, so npm bans match the `(^|/)node_modules/<pkg>/`
// tail. Node built-ins carry dependencyType "core", matched separately.
// An UNINSTALLED package is the one exception: nothing resolves it, so its
// module path is the specifier itself, which is why the expo and react-native
// bans below carry both spellings.
const RE_REACT = "(^|/)node_modules/react/";
const RE_REACT_DOM = "(^|/)node_modules/react-dom/";
const NATIVE = "(@expo/|@expo-google-fonts/|@react-native|(expo|react-native)([-/]|$))";
const RE_NATIVE = [`(^|/)node_modules/${NATIVE}`, `^${NATIVE}`];
const RE_IN_REPO = "^(?!node_modules/)";
/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are disallowed.",
      from: {},
      to: { circular: true },
    },
    {
      name: "imports-are-declared",
      severity: "error",
      comment:
        "dependency-cruiser's own no-non-package-json: code may import only what package.json declares. `nodeLinker: hoisted` (pnpm-workspace.yaml) puts every transitive dependency in the root node_modules where anything can reach it undeclared, which is the strictness the default linker exists to provide and the price React Native's resolvers charge for it. knip's dependency lane does not close this: it counts an import as declared when a declared package lists it as a peer dependency.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown", "unknown"] },
    },
    {
      name: "shipped-code-takes-no-dev-dependencies",
      severity: "error",
      comment:
        "dependency-cruiser's own not-to-dev-dep. The app bundles everything app, src and modules import, so a devDependency there (react-dom, msw, vitest, a testing library) would ship test tooling to users. Type-only imports are erased and stay allowed.",
      from: { path: "^(app|src|modules)/" },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: "(^|/)node_modules/@types/",
      },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "The domain is runtime-agnostic: global fetch + zod only. Stated positively, as what it MAY reach rather than as a list of the directories it may not: the ban then covers a directory added to the core tomorrow instead of waiting to be amended. In-repo, the domain may reach the domain and nothing else; from npm it may take no react.",
      from: { path: "^src/core/domain/" },
      to: {
        path: [RE_IN_REPO, RE_REACT],
        pathNot: "^src/core/domain/",
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "data-stays-headless",
      severity: "error",
      comment:
        "The data layer (clients/repos) is stated the same way round: in-repo it may reach the domain, its own tree and the ports it is filled through, and nothing else. That is what keeps a repository from reaching a hook, a store or the auth layer. From npm it may take no react.",
      from: { path: "^src/core/data/" },
      to: {
        path: [RE_IN_REPO, RE_REACT],
        pathNot: "^src/core/(data|domain|ports)/",
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "ports-have-no-impls",
      severity: "error",
      comment:
        "A port is a seam the app fills, so it may take value imports from the domain, from its sibling ports and from react, and nothing else. Stated that way rather than as 'types only': token-store.ts imports tokenSchema, a zod value, from domain/model/token, and three of the ports publish a React context and hook beside their interface, which is how a component reaches the injected instance. React is the injection mechanism rather than an implementation, and everything an implementation would actually need (the DOM or expo) is still banned here by core-stays-portable and by biome's globals override over src/core.",
      from: { path: "^src/core/ports/" },
      to: {
        dependencyTypesNot: ["type-only"],
        pathNot: ["^src/core/(ports|domain)/", RE_REACT],
      },
    },
    {
      name: "core-stays-portable",
      severity: "error",
      comment:
        "The core executes independently of its Expo host, so it takes neither DOM libraries nor React Native or Expo. Anchored at src because its tests run on Node and render hooks with React DOM.",
      from: { path: "^src/core/" },
      to: { path: [RE_REACT_DOM, ...RE_NATIVE] },
    },
    {
      name: "core-stays-portable-node",
      severity: "error",
      comment:
        "The other half of the same ban. It has to be a second rule: a `to` clause is a conjunction, so one rule carrying both the package list and dependencyTypes would read 'a module whose path matches AND which is a Node built-in', which is never true.",
      from: { path: "^src/core/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "queries-have-no-react",
      severity: "error",
      comment: "Query option factories cannot import React.",
      from: { path: "^src/core/queries/" },
      to: { path: RE_REACT },
    },
    {
      name: "core-imports-no-app",
      severity: "error",
      comment:
        "The core and its tests do not import the app. Dependencies flow into the core and never back out, or the core is no longer independent of its host.",
      from: { path: "^(src|test)/core/" },
      to: { path: "^(app|src|modules|plugins|__tests__)/", pathNot: "^src/core/" },
    },
    {
      name: "trakt-reads-stay-pooled",
      severity: "error",
      comment:
        "data/trakt/endpoints.ts issues raw, unpooled GETs. Only read-budget.ts " +
        "(the pool primitive) and pooled-endpoints.ts (its wrapper for every other " +
        "caller) may import it directly: every other read must go through a pooled " +
        "wrapper, so a read reachable from the runtime without withReadRateRetry " +
        "fails here by naming the unpooled importer, instead of only an instance test " +
        "that a mutation can dodge by pooling one caller and leaving the rest raw.",
      from: {
        path: "^src/",
        pathNot: "^src/core/data/trakt/(read-budget|pooled-endpoints)\\.ts$",
      },
      to: { path: "^src/core/data/trakt/endpoints\\.ts$" },
    },
    {
      name: "mark-revalidation-stays-scoped",
      severity: "error",
      comment:
        "query-invalidation.ts refreshes a marked show's OWN detail reads and " +
        "deliberately leaves the Up Next aggregate alone, so a surface that calls it " +
        "directly ticks show detail and leaves the queue row reading pre-mark " +
        "progress. Only hooks/library-cache.ts may reach it from the hook and UI " +
        "layers: its refreshShowProgress pairs that invalidation with the scoped " +
        "progress read that replaces the one library entry, so a new mark surface " +
        "fails here rather than shipping a queue that quietly stops moving.",
      from: {
        path: "^(src/(core/)?(hooks|queries|stores|ui|screens)|app)/",
        pathNot: "^src/core/hooks/library-cache\\.ts$",
      },
      to: { path: "^src/core/data/query-invalidation\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(dist|coverage|ios|android|\\.expo)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
      extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"],
    },
  },
};
