import { execFileSync } from "node:child_process";

const DOMAIN = "org.webkit.Playwright";
const GPU_PROCESS_KEY = "WebKit2GPUProcessForDOMRendering";

// WebKit reads this macOS user default before creating a page. A stored `0`
// disables GPU-process DOM rendering and makes every `newPage()` hang. An absent
// key or a stored `1` is healthy.
function isGpuProcessDomRenderingDisabled(): boolean {
  try {
    const value = execFileSync("defaults", ["read", DOMAIN, GPU_PROCESS_KEY], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return value.trim() === "0";
  } catch {
    // A missing key or domain is clean. Missing `defaults` and timeouts fail open.
    return false;
  }
}

export default function globalSetup(): void {
  if (process.platform !== "darwin") return;

  if (!isGpuProcessDomRenderingDisabled()) return;

  throw new Error(
    [
      `A stored false for ${GPU_PROCESS_KEY} in ${DOMAIN} overrides WebKit's shipped default.`,
      "WebKit will hang on every newPage(), and the mobile-webkit project will fail on timeouts.",
      "Delete the key to restore WebKit's default, then re-run:",
      "",
      `  defaults delete ${DOMAIN} ${GPU_PROCESS_KEY}`,
      "",
    ].join("\n"),
  );
}
