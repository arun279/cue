import { Capacitor } from "@capacitor/core";

/**
 * The sole touch-point for `@capacitor/*`. Everything native is confined to
 * src/platform (enforced by dependency-cruiser) so domain/data/ui stay portable.
 */
export function platformName(): string {
  return Capacitor.getPlatform();
}
