import { Capacitor } from "@capacitor/core";

/**
 * Capability probe: the composition root reads this to pick the
 * auth flow and the key-value backend. Native shells run under Capacitor; the web
 * build reports platform `web`. Also the sole `@capacitor/*` touch-point:
 * everything native is confined to src/platform (dependency-cruiser enforced) so
 * domain/data/ui stay portable.
 */
export function isNativePlatform(): boolean {
  return Capacitor.getPlatform() !== "web";
}
