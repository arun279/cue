import { useEffect } from "react";
import { AccessibilityInfo, type AccessibilityProps, Platform } from "react-native";

type Politeness = "polite" | "assertive";
type LiveRegionProps = Pick<AccessibilityProps, "accessibilityLiveRegion">;

const ANDROID: Readonly<Record<Politeness, LiveRegionProps>> = {
  polite: { accessibilityLiveRegion: "polite" },
  assertive: { accessibilityLiveRegion: "assertive" },
};
const NONE: LiveRegionProps = {};

/**
 * iOS needs an imperative announcement; Android has accessibilityLiveRegion.
 * Spread the result onto the view that holds the message.
 */
export function useLiveRegion(message: string | null, politeness: Politeness): LiveRegionProps {
  useEffect(() => {
    if (message === null || Platform.OS !== "ios") return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return Platform.OS === "android" ? ANDROID[politeness] : NONE;
}
