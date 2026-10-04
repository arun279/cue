import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { HAIRLINE, SPACE, useColors, useStacked } from "./tokens";

interface RowAction {
  readonly name: string;
  readonly label: string;
  onPress(): void;
}

export interface RowProps {
  readonly label: string;
  readonly minHeight: number;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly actions?: readonly RowAction[];
  readonly testID?: string;
  readonly children: ReactNode;
}

export function Row({
  label,
  minHeight,
  leading,
  trailing,
  onPress,
  actions,
  testID,
  children,
}: RowProps): ReactElement {
  const stacked = useStacked();

  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Pressable
        accessible
        accessibilityRole={onPress === undefined ? undefined : "button"}
        accessibilityLabel={label}
        accessibilityActions={actions?.map(({ name, label: actionLabel }) => ({
          name,
          label: actionLabel,
        }))}
        onAccessibilityAction={({ nativeEvent }) =>
          actions?.find((action) => action.name === nativeEvent.actionName)?.onPress()
        }
        testID={testID}
        onPress={onPress}
        style={[styles.body, { minHeight }, stacked && styles.bodyTop]}
      >
        {leading}
        <View style={styles.stack}>{children}</View>
      </Pressable>
      {trailing === undefined ? null : <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

export interface SeparatorProps {
  readonly inset?: number;
}

export function Separator({ inset = 0 }: SeparatorProps): ReactElement {
  const colors = useColors();
  return (
    <View style={[styles.separator, { backgroundColor: colors.separator, marginLeft: inset }]} />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.s2 },
  rowStacked: { flexDirection: "column", alignItems: "stretch" },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s3,
    paddingEnd: SPACE.s2,
  },
  bodyTop: { alignItems: "flex-start", paddingVertical: SPACE.s2 },
  stack: { flex: 1, minWidth: 0, gap: 2 },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: SPACE.s2,
  },
  separator: { flexShrink: 0, height: HAIRLINE },
});
