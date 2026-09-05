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
 * The one place a status is announced.
 *
 * The web app has eleven live regions. Android has `accessibilityLiveRegion`
 * and iOS has only the imperative announcement, so both go through here rather
 * than being spelled out at each of them. Keyed on the message, so a state
 * change speaks and a re-render does not, and focus is never moved.
 *
 * Spread the result onto the view that holds the message.
 */
export function useLiveRegion(message: string | null, politeness: Politeness): LiveRegionProps {
  useEffect(() => {
    if (message === null || Platform.OS !== "ios") return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return Platform.OS === "android" ? ANDROID[politeness] : NONE;
}
