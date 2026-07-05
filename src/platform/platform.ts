import { platformName } from "@platform/native";

/**
 * Capability probe: the composition root reads these to pick
 * the auth flow and the key-value backend. Native shells run under Capacitor;
 * the web build reports platform `web`.
 */
export function isNativePlatform(): boolean {
  return platformName() !== "web";
}
