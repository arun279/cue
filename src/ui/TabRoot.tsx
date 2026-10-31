import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

export function TabRoot({
  testID,
  children,
}: {
  readonly testID: string;
  readonly children: ReactNode;
}): ReactElement {
  // react-native-screens finds the scroll view through the first child view, which must not be flattened away.
  return (
    <View collapsable={false} testID={testID} style={styles.root}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
