import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { EmptyState } from "./EmptyState";
import { SPACE, useColors } from "./tokens";

export function ComingSoon({
  title,
  testID,
}: {
  readonly title: string;
  readonly testID: string;
}): ReactElement {
  const colors = useColors();
  return (
    <View testID={testID} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <EmptyState headline={title} body={`${title} is coming soon.`} />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, paddingHorizontal: SPACE.s4 } });
