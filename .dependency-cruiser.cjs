// dependency-cruiser resolves every `to.path` against the *resolved* module
// path, not the import specifier. Under pnpm that means npm packages surface as
// `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`, so npm bans must match
// the `(^|/)node_modules/<pkg>/` tail: a bare `^react` / `^@capacitor/` anchor
// never fires. Node built-ins carry dependencyType "core", matched separately.
// An UNINSTALLED package is the one exception: nothing resolves it, so its
// module path is the specifier itself, which is why the expo and react-native
// bans below carry both spellings.
const RE_REACT = "(^|/)node_modules/react/";
const RE_REACT_DOM = "(^|/)node_modules/react-dom/";
const RE_CAPACITOR = "(^|/)node_modules/@capacitor/";
const RE_NATIVE = ["(^|/)node_modules/(expo|react-native)([-/]|$)", "^(expo|react-native)([-/]|$)"];
// The web app's own libraries: the DOM renderer, its storage, its component
// primitives, its router, its virtualiser and its icons. Named one by one on
// purpose rather than as a @tanstack/react-* glob, because @tanstack/react-query
// is a portable dependency of the core that BOTH targets use.
const RE_WEB_ONLY = [
  RE_REACT_DOM,
  "(^|/)node_modules/idb-keyval/",
  "(^|/)node_modules/radix-ui/",
  "(^|/)node_modules/@tanstack/react-router/",
  "(^|/)node_modules/@tanstack/react-virtual/",
  "(^|/)node_modules/lucide-react/",
];
const RE_DOES_NOT_SHIP_DIRECTORY =
  "^(docs|\\.github|assets|scripts/mock-trakt|packages/[^/]+/(e2e|test|__tests__))(/|$)";
const RE_DOES_NOT_SHIP_MARKDOWN = "^[^/]*\\.md$";
const RE_DOES_NOT_SHIP_FILE =
  "^(LICENSE|vitest\\.config\\.ts|lefthook\\.yml|cspell\\.json|dprint\\.json|biome\\.jsonc|knip\\.json|\\.jscpd\\.json|\\.dependency-cruiser\\.cjs|\\.gitignore|scripts/write-buster\\.mjs|tsconfig\\.depcruise\\.json|packages/[^/]+/(playwright\\.config\\.ts|vitest\\.config\\.ts|jest\\.config\\.js|\\.gitignore|\\.env\\.(example|test|mock)))$";

const { join } = require("node:path");

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
    // These patterns mirror DOES_NOT_SHIP in packages/web/test/ci/release-paths.test.ts.
    // Changes to that list require matching updates here.
    // Known gaps: this rule is static analysis over import specifiers that
    // dependency-cruiser can resolve. import.meta.glob(...) and
    // new URL("...", import.meta.url) are invisible to it. Neither produces a
    // resolvable import edge that dependency-cruiser follows, so a file matched
    // by either idiom is never flagged, even if it points at a non-shipping
    // path. import.meta.glob(...) is already used in
    // packages/web/src/ui/screens/settings/Settings.tsx. Also, the from anchor
    // covers only the first edge out of a package's src. It does not cover a
    // transitive hop through a non-src root file that imports a non-shipping path.
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
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "The domain is runtime-agnostic: global fetch + zod only. Stated positively, as what it MAY reach rather than as a list of the directories it may not: the ban then covers a directory added to the core tomorrow instead of waiting to be amended. In-repo, the domain may reach the domain and nothing else; from npm it may take no react, no react-dom and no capacitor.",
      from: { path: "^packages/core/src/domain/" },
      to: {
        path: ["^packages/", RE_REACT, RE_REACT_DOM, RE_CAPACITOR],
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
        "A port is a seam the apps fill, so it may take value imports from the domain, from its sibling ports and from react, and nothing else. Stated that way rather than as 'types only': token-store.ts imports tokenSchema, a zod value, from domain/model/token, and five of the ports publish a React context and hook beside their interface, which is how a component reaches the injected instance. React is the injection mechanism rather than an implementation, and everything an implementation would actually need (the DOM, idb-keyval, @capacitor/*, expo) is still banned here by core-stays-portable and by biome's globals override over this package.",
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
        "@cue/core executes on both targets, so it takes no library that belongs to one of them: not the DOM renderer or its storage and component primitives, not React Native or Expo, not the bundler. Anchored at src because the package's own vitest suite runs on Node and reads git; web-owns-dom and native-owns-expo hold the same line over its test tree.",
      from: { path: "^packages/core/src/" },
      to: { path: [...RE_WEB_ONLY, ...RE_NATIVE, "(^|/)node_modules/vite/"] },
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
      name: "core-imports-no-app",
      severity: "error",
      comment:
        "The shared package imports neither app. Dependencies flow into the core and never back out, or the claim that both targets run the same code is only a claim.",
      from: { path: "^packages/core/" },
      to: { path: "^packages/(web|native)/" },
    },
    {
      name: "web-owns-dom",
      severity: "error",
      comment:
        "The DOM renderer and the libraries built on it belong to the web app. Named one by one rather than as a @tanstack/react-* glob, because @tanstack/react-query is portable and the core's own layer imports it.",
      from: { path: "^packages/", pathNot: "^packages/web/" },
      to: { path: RE_WEB_ONLY },
    },
    {
      name: "native-owns-expo",
      severity: "error",
      comment: "Expo and React Native belong to the native app and to nothing else.",
      from: { path: "^packages/", pathNot: "^packages/native/" },
      to: { path: RE_NATIVE },
    },
    {
      name: "apps-do-not-cross",
      severity: "error",
      comment:
        "Neither app imports the other; what they share, they share through @cue/core. The $1 backreference into the from group is what keeps this one rule: anchored without it, it forbids a package importing itself.",
      from: { path: "^packages/(web|native)/" },
      to: { path: "^packages/(web|native)/", pathNot: "^packages/$1/" },
    },
    {
      name: "ui-no-platform-impl",
      severity: "error",
      comment:
        "The web app's screens depend on core abstractions; platform impls and the composition root are injected, not imported directly.",
      from: { path: "^packages/web/src/ui/" },
      to: { path: "^packages/web/src/(platform|app)/" },
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
      name: "capacitor-only-in-platform",
      severity: "error",
      comment:
        "@capacitor/* is imported ONLY in the web app's platform directory, keeping the core and every screen portable and testable without native mocks.",
      from: { path: "^packages/[^/]+/src/", pathNot: "^packages/web/src/platform/" },
      to: { path: RE_CAPACITOR },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Anchor to project root: an unanchored `(^|/)dist/` also matched
    // node_modules/@capacitor/core/dist/*, silently excluding capacitor from the
    // graph so every capacitor ban passed.
    exclude: { path: "^(packages/[^/]+/(dist|coverage)|coverage|ios|android)/" },
    tsPreCompilationDeps: true,
    // The web package's aliases, reached through the wrapper that names their
    // base directory; tsconfig.depcruise.json says why. Absolute, because
    // dependency-cruiser hands this name to TypeScript as both the base path
    // and the config name, and a relative one makes an `extends` resolve one
    // directory level too deep.
    tsConfig: { fileName: join(__dirname, "tsconfig.depcruise.json") },
    enhancedResolveOptions: {
      // exportsFields is what resolves @cue/core/... at all: the package declares
      // one wildcard subpath key and no main. Capacitor is the mirror case, it
      // ships only main/module and no exports, so dropping mainFields would take
      // it out of the graph entirely and every capacitor ban would silently pass.
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
