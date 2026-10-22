interface Performance {
  readonly rnStartupTiming?: {
    readonly startTime?: number | null;
    readonly initializeRuntimeStart?: number | null;
    readonly executeJavaScriptBundleEntryPointStart?: number | null;
  };
}
