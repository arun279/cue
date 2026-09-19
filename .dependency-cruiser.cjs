// dependency-cruiser resolves every `to.path` against the *resolved* module
// path, not the import specifier. Under pnpm that means npm packages surface as
// `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`, so npm bans must match
// the `(^|/)node_modules/<pkg>/` tail: a bare `^react` / `^@capacitor/` anchor
// never fires. Node built-ins carry dependencyType "core", matched separately.
const RE_REACT = "(^|/)node_modules/react/";
const RE_REACT_DOM = "(^|/)node_modules/react-dom/";
const RE_CAPACITOR = "(^|/)node_modules/@capacitor/";

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
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "src/domain is runtime-agnostic: global fetch + zod only. No data/ui/app/platform, no react, no react-dom, no capacitor.",
      from: { path: "^src/domain/" },
      to: {
        path: ["^src/(data|ui|platform|app)/", RE_REACT, RE_REACT_DOM, RE_CAPACITOR],
      },
    },
    {
      name: "domain-no-node-builtins",
      severity: "error",
      comment:
        "src/domain must not touch Node built-ins (fs/path/crypto/...); it runs in browser + native.",
      from: { path: "^src/domain/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "data-stays-headless",
      severity: "error",
      comment:
        "src/data (clients/repos) may import domain, but never ui/app/platform, react, or react-dom.",
      from: { path: "^src/data/" },
      to: { path: ["^src/(ui|app|platform)/", RE_REACT, RE_REACT_DOM] },
    },
    {
      name: "ui-no-platform-impl",
      severity: "error",
      comment:
        "src/ui depends on domain/data abstractions; platform impls and the app composition root are injected, not imported directly.",
      from: { path: "^src/ui/" },
      to: { path: "^src/(platform|app)/" },
    },
    {
      name: "trakt-reads-stay-pooled",
      severity: "error",
      comment:
        "src/data/trakt/endpoints.ts issues raw, unpooled GETs. Only read-budget.ts " +
        "(the pool primitive) and pooled-endpoints.ts (its wrapper for every other " +
        "caller) may import it directly: every other read must go through a pooled " +
        "wrapper, so a read reachable from the runtime without withReadRateRetry " +
        "fails here by naming the unpooled importer, instead of only an instance test " +
        "that a mutation can dodge by pooling one caller and leaving the rest raw.",
      from: {
        path: "^src/",
        pathNot: "^src/data/trakt/(read-budget|pooled-endpoints)\\.ts$",
      },
      to: { path: "^src/data/trakt/endpoints\\.ts$" },
    },
    {
      name: "capacitor-only-in-platform",
      severity: "error",
      comment:
        "@capacitor/* is imported ONLY in src/platform, keeping domain/data/ui/app portable and testable without native mocks.",
      from: { path: "^src/", pathNot: "^src/platform/" },
      to: { path: RE_CAPACITOR },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Anchor to project root: an unanchored `(^|/)dist/` also matched
    // node_modules/@capacitor/core/dist/*, silently excluding capacitor from the
    // graph so every capacitor ban passed.
    exclude: { path: "^(dist|coverage|ios|android)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      // Capacitor ships only `main`/`module` (no `exports`), so an
      // `exportsFields`-only resolver drops it from the graph entirely and every
      // capacitor ban silently passes. Listing `mainFields` restores resolution.
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "browser", "default"],
      mainFields: ["module", "browser", "main"],
      extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"],
    },
  },
};
