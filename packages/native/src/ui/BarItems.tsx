import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Avatar } from "./Avatar";
import { TEST_IDS } from "./test-ids";
import { SPACE, TARGET_MIN, useColors } from "./tokens";

const GLYPH = 22;
const AVATAR = 32;

export interface BarItemsProps {
  onSync(): void;
}

// "Sync now" is the single-pointer alternative to pull to refresh that WCAG 2.5.1 and 2.5.7 require.
export function BarItems({ onSync }: BarItemsProps): ReactElement {
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
        <Avatar size={AVATAR} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  items: { flexDirection: "row", alignItems: "center", gap: SPACE.s2 },
  target: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
