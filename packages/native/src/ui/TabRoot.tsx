import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useColors } from "./tokens";

export function TabRoot({
  testID,
  children,
}: {
  readonly testID: string;
  readonly children: ReactNode;
}): ReactElement {
  const colors = useColors();
  // react-native-screens finds the scroll view through the first child view, and React Native flattens a background-only view.
  return (
    <View collapsable={false} testID={testID} style={[styles.root, { backgroundColor: colors.bg }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
