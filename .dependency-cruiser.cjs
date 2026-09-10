// dependency-cruiser resolves every `to.path` against the *resolved* module
// path, not the import specifier. Under pnpm that means npm packages surface as
// `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`, so npm bans must match
// the `(^|/)node_modules/<pkg>/` tail. Node built-ins carry dependencyType
// "core", matched separately.
// An UNINSTALLED package is the one exception: nothing resolves it, so its
// module path is the specifier itself, which is why the expo and react-native
// bans below carry both spellings.
const RE_REACT = "(^|/)node_modules/react/";
const RE_REACT_DOM = "(^|/)node_modules/react-dom/";
const RE_NATIVE = ["(^|/)node_modules/(expo|react-native)([-/]|$)", "^(expo|react-native)([-/]|$)"];
const RE_DOM_ONLY = [
  RE_REACT_DOM,
  "(^|/)node_modules/idb-keyval/",
  "(^|/)node_modules/radix-ui/",
  "(^|/)node_modules/@tanstack/react-router/",
  "(^|/)node_modules/@tanstack/react-virtual/",
  "(^|/)node_modules/lucide-react/",
];
const RE_DOES_NOT_SHIP_DIRECTORY =
  "^(docs|test|\\.github|\\.maestro|scripts/(complexity|mock-trakt)|packages/[^/]+/(test|__tests__))(/|$)";
const RE_DOES_NOT_SHIP_MARKDOWN = "^[^/]*\\.md$";
const RE_DOES_NOT_SHIP_FILE =
  "^(LICENSE|vitest\\.config\\.ts|lefthook\\.yml|cspell\\.json|dprint\\.json|biome\\.jsonc|knip\\.json|\\.jscpd\\.json|\\.dependency-cruiser\\.cjs|\\.gitignore|\\.size-limit\\.json|\\.startup-time-limit\\.json|\\.native-assets\\.json|scripts/(assert-file-size|bundletool-size|check-native-assets|check-quality-budget|check-render-counts|check-size|check-size-delta|check-size-ratchet|check-startup-ratchet|check-type-suppressions|measure-comments|measure-complexity|summarize-atlas|summarize-startup-timing)\\.mjs|scripts/(diff-footprint|measure-play-size|measure-sizes|verify-android-launch|verify-ios-privacy)\\.sh|scripts/(quality-budget\\.json|write-buster\\.mjs)|packages/[^/]+/(vitest\\.config\\.ts|jest\\.config\\.js|tsconfig\\.test\\.json|\\.reassure/.+|\\.gitignore|\\.env\\.(example|test|mock)))$";

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
    // These patterns mirror DOES_NOT_SHIP in test/ci/release-paths.test.ts.
    // Changes to that list require matching updates here.
    // Known gap: the from anchor covers only the first edge out of a package's
    // source tree. It does not cover a transitive hop through a non-source root
    // file that imports a non-shipping path.
    {
      name: "src-no-non-shipping-imports",
      severity: "error",
      comment:
        "Importing a non-shipping path into src can put it in the production bundle while mobile release paths-ignore still skips changes to it.",
      from: { path: "^packages/[^/]+/src/" },
      to: {
        path: [RE_DOES_NOT_SHIP_DIRECTORY, RE_DOES_NOT_SHIP_MARKDOWN, RE_DOES_NOT_SHIP_FILE],
      },
    },
    {
      name: "packages-declare-their-imports",
      severity: "error",
      comment:
        "dependency-cruiser's own no-non-package-json, anchored at the packages. A package may import only what its OWN manifest declares. `nodeLinker: hoisted` (pnpm-workspace.yaml) puts every transitive dependency at the workspace root where any package can reach it undeclared, which is the strictness the default linker exists to provide and the price the native package's resolver charges for it. knip's dependency lane does not close this: react is a peerDependency of @tanstack/react-query, so it read 33 undeclared react imports in @cue/core as satisfied.",
      from: { path: "^packages/" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown", "unknown"] },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "The domain is runtime-agnostic: global fetch + zod only. Stated positively, as what it MAY reach rather than as a list of the directories it may not: the ban then covers a directory added to the core tomorrow instead of waiting to be amended. In-repo, the domain may reach the domain and nothing else; from npm it may take no react and no react-dom.",
      from: { path: "^packages/core/src/domain/" },
      to: {
        path: ["^packages/", RE_REACT, RE_REACT_DOM],
        pathNot: "^packages/core/src/domain/",
      },
    },
    {
      name: "domain-no-node-builtins",
      severity: "error",
      comment:
        "The domain must not touch Node built-ins (fs/path/crypto/...); it runs in a browser and on a native engine. Kept beside the other domain rules even though core-stays-portable-node bans them across the package, because the stricter statement belongs where the domain rules are read.",
      from: { path: "^packages/core/src/domain/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "data-stays-headless",
      severity: "error",
      comment:
        "The data layer (clients/repos) is stated the same way round: in-repo it may reach the domain, its own tree and the ports it is filled through, and nothing else. That is what keeps a repository from reaching a hook, a store or the auth layer, which the directory blacklist this replaces stopped covering the moment those trees moved into the core. From npm it may take no react and no react-dom.",
      from: { path: "^packages/core/src/data/" },
      to: {
        path: ["^packages/", RE_REACT, RE_REACT_DOM],
        pathNot: "^packages/core/src/(data|domain|ports)/",
      },
    },
    {
      name: "ports-have-no-impls",
      severity: "error",
      comment:
        "A port is a seam the apps fill, so it may take value imports from the domain, from its sibling ports and from react, and nothing else. Stated that way rather than as 'types only': token-store.ts imports tokenSchema, a zod value, from domain/model/token, and five of the ports publish a React context and hook beside their interface, which is how a component reaches the injected instance. React is the injection mechanism rather than an implementation, and everything an implementation would actually need (the DOM, idb-keyval or expo) is still banned here by core-stays-portable and by biome's globals override over this package.",
      from: { path: "^packages/core/src/ports/" },
      to: {
        dependencyTypesNot: ["type-only"],
        pathNot: ["^packages/core/src/(ports|domain)/", RE_REACT],
      },
    },
    {
      name: "core-stays-portable",
      severity: "error",
      comment:
        "@cue/core executes independently of its Expo host, so it takes neither DOM libraries nor React Native or Expo. Anchored at src because the package's own test suite runs on Node and reads git.",
      from: { path: "^packages/core/src/" },
      to: { path: [...RE_DOM_ONLY, ...RE_NATIVE] },
    },
    {
      name: "core-stays-portable-node",
      severity: "error",
      comment:
        "The other half of the same ban. It has to be a second rule: a `to` clause is a conjunction, so one rule carrying both the package list and dependencyTypes would read 'a module whose path matches AND which is a Node built-in', which is never true.",
      from: { path: "^packages/core/src/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "queries-have-no-react",
      severity: "error",
      comment: "Query option factories cannot import React.",
      from: { path: "^packages/core/src/queries/" },
      to: { path: RE_REACT },
    },
    {
      name: "core-imports-no-app",
      severity: "error",
      comment:
        "The shared package imports neither app. Dependencies flow into the core and never back out, or the claim that both targets run the same code is only a claim.",
      from: { path: "^packages/core/" },
      to: { path: "^packages/native/" },
    },
    {
      name: "native-owns-expo",
      severity: "error",
      comment: "Expo and React Native belong to the native app and to nothing else.",
      from: { path: "^packages/", pathNot: "^packages/native/" },
      to: { path: RE_NATIVE },
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
        path: "^packages/[^/]+/src/",
        pathNot: "^packages/core/src/data/trakt/(read-budget|pooled-endpoints)\\.ts$",
      },
      to: { path: "^packages/core/src/data/trakt/endpoints\\.ts$" },
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
        path: "^packages/[^/]+/(src/(hooks|queries|stores|ui|screens)|app)/",
        pathNot: "^packages/core/src/hooks/library-cache\\.ts$",
      },
      to: { path: "^packages/core/src/data/query-invalidation\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(packages/[^/]+/(dist|coverage)|coverage)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // exportsFields is what resolves @cue/core/... at all: the package declares
      // one wildcard subpath key and no main.
      // preserveSymlinks defaults to false, which resolves the workspace link to
      // its realpath under packages/core, which is what makes the anchors above
      // match instead of node_modules.
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "browser", "default"],
      mainFields: ["module", "browser", "main"],
      extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"],
    },
  },
};
