import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";

// A zero-sized view has no bounds, so no accessibility hierarchy lists it.
export function Marker({
  accessibilityLabel,
  testID,
}: {
  readonly accessibilityLabel?: string;
  readonly testID: string;
}): ReactElement {
  return (
    <View
      accessible={accessibilityLabel === undefined ? undefined : true}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      pointerEvents="none"
      style={styles.marker}
    />
  );
}

const styles = StyleSheet.create({
  marker: {
    position: "absolute",
    left: Platform.OS === "android" ? "50%" : 0,
    top: "50%",
    width: 1,
    height: 1,
  },
});
