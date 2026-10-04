import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Avatar } from "./Avatar";
import { TEST_IDS } from "./test-ids";
import { SPACE, TARGET_MIN, useColors } from "./tokens";

const AVATAR = 32;
const GLYPH = 24;
export const CLOSE =
  "M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z";
const REFRESH =
  "M17.65,6.35C16.2,4.9 14.21,4 12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z";

export interface BarItemsProps {
  onSync(): void;
  readonly avatar?: boolean;
}

// "Sync now" is the single-pointer alternative to pull to refresh that WCAG 2.5.1 and 2.5.7 require.
export function BarItems({ onSync, avatar = true }: BarItemsProps): ReactElement {
  if (Platform.OS === "android")
    return (
      <Stack.Toolbar placement="right" asChild>
        <View style={styles.items}>
          <BarIcon label="Sync now" path={REFRESH} onPress={onSync} />
          {avatar && <AvatarLink />}
        </View>
      </Stack.Toolbar>
    );

  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel="Sync now" onPress={onSync} />
      {avatar && (
        <Stack.Toolbar.View>
          <AvatarLink />
        </Stack.Toolbar.View>
      )}
    </Stack.Toolbar>
  );
}

export interface BarIconProps {
  readonly label: string;
  readonly path: string;
  onPress(): void;
}

export function BarIcon({ label, path, onPress }: BarIconProps): ReactElement {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.target}
    >
      <Svg width={GLYPH} height={GLYPH} viewBox="0 0 24 24">
        <Path d={path} fill={colors.accentInk} />
      </Svg>
    </Pressable>
  );
}

function AvatarLink(): ReactElement {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      testID={TEST_IDS.avatarLink}
      onPress={() => router.push("/profile")}
      style={styles.target}
    >
      <Avatar size={AVATAR} />
    </Pressable>
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
