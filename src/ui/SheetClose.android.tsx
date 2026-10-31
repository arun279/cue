import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { PlatformIcon } from "./PlatformIcon";
import { TARGET_MIN, useColors } from "./tokens";

export function SheetClose(): ReactElement {
  const router = useRouter();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={() => router.back()}
      android_ripple={{ borderless: true, radius: TARGET_MIN / 2 }}
      style={styles.close}
    >
      <PlatformIcon name="close" color={colors.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
