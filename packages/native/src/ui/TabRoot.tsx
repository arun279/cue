import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useColors } from "./tokens";

/**
 * The root view of a screen whose bar collapses a large title or floats over its
 * list. It stays unflattened so UIKit finds the list first under the screen.
 */
export function TabRoot({
  testID,
  children,
}: {
  readonly testID: string;
  readonly children: ReactNode;
}): ReactElement {
  const colors = useColors();
  return (
    <View collapsable={false} testID={testID} style={[styles.root, { backgroundColor: colors.bg }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
