import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";

const GLYPH = 22;
const AVATAR = 32;

export interface UpNextBarItemsProps {
  onSync(): void;
}

/**
 * The tab root's trailing bar items: "Sync now", and the avatar the account area
 * sits behind.
 *
 * "Sync now" is load bearing rather than a convenience. It is the single-pointer,
 * non-path alternative to the pull gesture that WCAG 2.5.1 and 2.5.7 require, and
 * it runs exactly the same pass the pull does. Answering the pull with a control
 * four steps away in Settings satisfied the criterion and was not defensible
 * beside a Stop that is co-located on its own row.
 */
export function UpNextBarItems({ onSync }: UpNextBarItemsProps): ReactElement {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={styles.items}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sync now"
        testID={TEST_IDS.syncNow}
        onPress={onSync}
        style={styles.target}
      >
        <Svg width={GLYPH} height={GLYPH} viewBox="0 0 24 24">
          <Path
            d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"
            fill="none"
            stroke={colors.accentInk}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        testID={TEST_IDS.avatarLink}
        onPress={() => router.push("/profile")}
        style={styles.target}
      >
        <View style={[styles.avatar, { backgroundColor: colors.elevated }]}>
          <Svg width={GLYPH} height={GLYPH} viewBox="0 0 24 24">
            <Circle cx="12" cy="9" r="3.4" fill={colors.muted} />
            <Path
              d="M5.5 19.5a6.5 6.5 0 0 1 13 0"
              fill="none"
              stroke={colors.muted}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // The SPACE rule: two adjacent targets, 8 pt apart, and the gap never shrinks.
  items: { flexDirection: "row", alignItems: "center", gap: SPACE.s2 },
  target: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
});
